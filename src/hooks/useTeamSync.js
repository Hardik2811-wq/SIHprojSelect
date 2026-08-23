import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

const EMPTY = Array.from({length:6},(_,slot)=>({slot, idx:slot, name:"",skills:{}}));

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
          return d ? {slot:e.slot, idx:e.slot, name:d.name||"", skills:d.skills||{}} : e; 
        }));
      }
      setReady(true);
    })();
    const ch = supabase.channel("team-members")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, (payload) => {
        const row = payload.new && payload.new.slot != null ? payload.new : payload.old;
        if (row && row.slot != null) {
          setMembers(prev => prev.map(m => m.slot === row.slot 
            ? {slot: row.slot, idx: row.slot, name: payload.eventType==="DELETE" ? "" : row.name || "", skills: payload.eventType==="DELETE" ? {} : row.skills || {}} 
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
