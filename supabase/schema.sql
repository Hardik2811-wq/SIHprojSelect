-- ============================================================
-- SIH 2026 Skill-Match — Supabase schema
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- Then click "Run".
-- ============================================================

-- 1. Team member slots (6 pre-seeded rows)
create table if not exists public.team_members (
  slot       int primary key check (slot between 0 and 5),
  name       text not null default '',
  skills     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 2. Per-problem marks: votes, our-pick, notes
create table if not exists public.problem_marks (
  ps_id      text primary key,
  votes      jsonb not null default '{}'::jsonb,  -- { "MemberName": true }
  our_pick   boolean not null default false,
  notes      text not null default '',
  updated_at timestamptz not null default now()
);

-- 3. Row Level Security: open-link mode — anyone can read/write
alter table public.team_members  enable row level security;
alter table public.problem_marks enable row level security;

drop policy if exists "members_public_access" on public.team_members;
create policy "members_public_access" on public.team_members
  for all using (true) with check (true);

drop policy if exists "marks_public_access" on public.problem_marks;
create policy "marks_public_access" on public.problem_marks
  for all using (true) with check (true);

-- 4. Enable realtime broadcasts (idempotent — will not drop active subscriptions)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter publication supabase_realtime add table public.team_members;
alter publication supabase_realtime add table public.problem_marks;

-- 5. Seed the 6 slots
insert into public.team_members (slot) values (0),(1),(2),(3),(4),(5)
on conflict (slot) do nothing;

-- Done. Verify: Table Editor should show team_members (6 rows) and problem_marks.
