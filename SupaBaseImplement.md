# Supabase Realtime Integration — Implementation Guide

## Project Context
- **App**: SIH 2026 Team Skill-Match & Ranking (React + Tailwind, Vite)
- **Current state**: Local-only, 6-member skill panel, 172 PS flip cards, CSV export
- **Goal**: Add realtime collaboration so 6 teammates share one dashboard via Supabase
- **Supabase project**: `https://saktxhlkegyrfakehldw.supabase.co` (publishable key provided)

---

## 1. Database Schema (Run Once in SQL Editor)

```sql
-- supabase/schema.sql
create table if not exists public.team_members (
  slot       int primary key check (slot between 0 and 5),
  name       text not null default '',
  skills     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.problem_marks (
  ps_id      text primary key,
  votes      jsonb not null default '{}'::jsonb,   -- { "MemberName": true }
  our_pick   boolean not null default false,
  notes      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.team_members  enable row level security;
alter table public.problem_marks enable row level security;

drop policy if exists "members_public_access" on public.team_members;
create policy "members_public_access" on public.team_members
  for all using (true) with check (true);

drop policy if exists "marks_public_access" on public.problem_marks;
create policy "marks_public_access" on public.problem_marks
  for all using (true) with check (true);

drop publication if exists supabase_realtime;
create publication supabase_realtime;
alter publication supabase_realtime add table public.team_members;
alter publication supabase_realtime add table public.problem_marks;

insert into public.team_members (slot) values (0),(1),(2),(3),(4),(5)
on conflict (slot) do nothing;
```

---

## 2. Environment Configuration

| File | Content |
|------|---------|
| `.env` (gitignored) | `VITE_SUPABASE_URL=https://saktxhlkegyrfakehldw.supabase.co`<br>`VITE_SUPABASE_ANON_KEY=sb_publishable_7a77G0ATmTDPNN4xdOfC3Q_dcWUqfRF` |
| `.env.example` | Same keys with placeholder values |
| `.gitignore` (add) | `.env`<br>`node_modules`<br>`dist` |

---

## 3. Dependency

```bash
npm install @supabase/supabase-js
```

---

## 4. Core Library Files

### `src/lib/supabase.js`
```js
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;
export const isCloud = !!supabase;
```

### `src/hooks/useTeamSync.js`
```js
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

const EMPTY = Array.from({length:6},(_,slot)=>({slot,name:"",skills:{}}));

export default function useTeamSync() {
  const [members, setMembers] = useState(EMPTY);
  const [ready, setReady] = useState(!supabase);
  const timers = useRef({});

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("team_members").select("*").order("slot");
      if (cancelled) return;
      if (!error && data) {
        setMembers(EMPTY.map(e => { 
          const d = data.find(x => x.slot === e.slot); 
          return d ? {slot:e.slot, name:d.name||"", skills:d.skills||{}} : e; 
        }));
      }
      setReady(true);
    })();
    const ch = supabase.channel("team-members")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, (payload) => {
        const row = payload.new && payload.new.slot != null ? payload.new : payload.old;
        if (row && row.slot != null) {
          setMembers(prev => prev.map(m => m.slot === row.slot 
            ? {slot: row.slot, name: payload.eventType==="DELETE" ? "" : row.name || "", skills: payload.eventType==="DELETE" ? {} : row.skills || {}} 
            : m));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); cancelled = true; };
  }, []);

  const saveSlot = useCallback((slot, patch) => {
    if (!supabase) return;
    clearTimeout(timers.current[slot]);
    timers.current[slot] = setTimeout(() => {
      supabase.from("team_members").upsert({ slot, ...patch, updated_at: new Date().toISOString() });
    }, 400);
  }, []);

  return { members, setMembers, saveSlot, ready };
}
```

### `src/hooks/useMarksSync.js`
```js
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

export function useMarksSync() {
  const [marks, setMarks] = useState({});
  useEffect(() => {
    if (!supabase) return;
    (async () => { 
      const { data } = await supabase.from("problem_marks").select("*"); 
      if (data) setMarks(Object.fromEntries(data.map(r=>[r.ps_id, r]))); 
    })();
    const ch = supabase.channel("problem-marks")
      .on("postgres_changes", { event: "*", schema: "public", table: "problem_marks" }, (payload) => {
        if (payload.eventType === "DELETE") setMarks(prev => { const n={...prev}; delete n[payload.old.ps_id]; return n; });
        else setMarks(prev => ({ ...prev, [payload.new.ps_id]: payload.new }));
      }).subscribe();
    return () => supabase.removeChannel(ch);
  }, []);
  const updateMark = useCallback((ps_id, patch) => {
    setMarks(prev => ({...prev, [ps_id]: {...(prev[ps_id]||{votes:{},our_pick:false,notes:""}), ...patch}}));
    if (supabase) supabase.from("problem_marks").upsert({ ps_id, ...patch, updated_at: new Date().toISOString() });
  }, []);
  return { marks, updateMark };
}
```

### `src/hooks/usePresence.js`
```js
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

export function usePresence(myName) {
  const [online, setOnline] = useState([]);
  useEffect(() => {
    if (!supabase || !myName) return;
    const ch = supabase.channel("team-presence", { config: { presence: { key: myName } } })
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState())))
      .subscribe(status => { if (status === "SUBSCRIBED") ch.track({ name: myName }); });
    return () => supabase.removeChannel(ch);
  }, [myName]);
  return online;
}
```

---

## 5. UI Changes in `App.jsx`

### Slot Picker Modal (on first load)
- Reads/writes `localStorage('sih_me')` → `{ slot, name }`
- Shows 6 slots with current occupant names; click empty → enter name
- Persists choice; teammate can't pick occupied slot

### Members Panel
- **Your slot** (matching `me.slot`): full editable chips + sliders → calls `saveSlot()`
- **Other 5 slots**: read-only compact view (name + skill badges)
- `MemberSlot` component gets `readOnly` prop

### Coverage Strip
- Computed from shared `members` state (works both cloud/local)

### Problem Card Back Face Additions
| Element | Behavior |
|---------|----------|
| 👍 Vote | Toggle my name in `votes` jsonb; debounced `updateMark(psId, {votes})` |
| ⭐ Our Pick | Checkbox → `our_pick` boolean |
| 📝 Notes | Textarea with 800ms debounce on blur → `notes` field |

### Header
- Presence badges: green dots + names from `usePresence(me.name)`
- Cloud status banner if `!isCloud` → "Offline mode — set env vars"

### Fallback
- If env vars missing → `supabase = null` → all hooks fall back to local-only behavior (original app unchanged)

---

## 6. Data Models (TypeScript-friendly JSDoc)

```js
/**
 * @typedef {Object} TeamMember
 * @property {number} slot - 0-5
 * @property {string} name
 * @property {Object.<string,number>} skills - { "Machine Learning / AI": 4, ... }
 */

/**
 * @typedef {Object} ProblemMark
 * @property {string} ps_id
 * @property {Object.<string,boolean>} votes
 * @property {boolean} our_pick
 * @property {string} notes
 */
```

---

## 7. Deployment Checklist

| Step | Where |
|------|-------|
| Run `supabase/schema.sql` | Supabase Dashboard → SQL Editor |
| Add env vars | Vercel Project → Settings → Environment Variables |
| Push to GitHub | Ensure `.env` is gitignored |
| Import in Vercel | Auto-detects Vite, builds `dist/` |

---

## 8. Verification Steps

1. `npm run dev` → open 2 browser tabs
2. Tab A: pick slot 0, enter "Alice", add skills
3. Tab B: pick slot 1, enter "Bob" → Alice's skills appear instantly
4. On any problem card back face: vote/pick/notes → visible in both tabs
5. Presence dots show both online
6. `npm run build` passes

---

## 9. File Tree Summary

```
webapp/
├── .env.example
├── .gitignore
├── supabase/
│   └── schema.sql
├── src/
│   ├── lib/
│   │   └── supabase.js
│   ├── hooks/
│   │   ├── useTeamSync.js
│   │   ├── useMarksSync.js
│   │   └── usePresence.js
│   ├── App.jsx       (updated)
│   └── ...
└── package.json      (+ @supabase/supabase-js)
```

---

## Decision Confirmation

- **Scope**: skills + votes + our-pick + notes (shared across team)
- **Access**: open link (anyone with URL can edit)
- **Presence**: simple green-dot + name badges