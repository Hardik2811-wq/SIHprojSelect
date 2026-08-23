import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "../lib/supabase.js";

const EMPTY = Array.from({length:6},(_,slot)=>({slot, idx:slot, name:"",skills:{}}));

export default function useTeamSync(me) {
  const [members, setMembers] = useState(EMPTY);
  const [ready, setReady] = useState(!supabase);
  const [dbError, setDbError] = useState(null);
  const timers = useRef({});
  const meRef = useRef(me);

  useEffect(() => {
    meRef.current = me;
  }, [me]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("team_members").select("*").order("slot");
      if (cancelled) return;
      if (error) {
        console.error("useTeamSync fetch error:", error);
        setDbError(error.message || "Failed to load team data");
        setReady(true);
        return;
      }
      if (data) {
        setMembers(EMPTY.map(e => { 
          const d = data.find(x => x.slot === e.slot); 
          return d ? {slot:e.slot, idx:e.slot, name:d.name||"", skills:d.skills||{}} : e; 
        }));
      }
      setDbError(null);
      setReady(true);
    })();
    const ch = supabase.channel("team-members")
      .on("postgres_changes", { event: "*", schema: "public", table: "team_members" }, (payload) => {
        const row = payload.new && payload.new.slot != null ? payload.new : payload.old;
        if (row && row.slot != null) {
          const currentMe = meRef.current;
          // Ignore echo updates for our own slot only if the name matches.
          if (currentMe && row.slot === currentMe.slot && row.name === currentMe.name) {
            return;
          }
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

  // Immediate save — no debounce, used for slot claiming
  const saveSlotNow = useCallback(async (slot, patch) => {
    if (!supabase) return { error: null };
    clearTimeout(timers.current[slot]);
    const { error } = await supabase
      .from("team_members")
      .upsert({ slot, ...patch, updated_at: new Date().toISOString() });
    return { error };
  }, []);

  // Re-fetch fresh state from DB (used before slot claim to prevent races)
  const refetch = useCallback(async () => {
    if (!supabase) return [];
    const { data } = await supabase.from("team_members").select("*").order("slot");
    if (data) {
      const fresh = EMPTY.map(e => {
        const d = data.find(x => x.slot === e.slot);
        return d ? {slot:e.slot, idx:e.slot, name:d.name||"", skills:d.skills||{}} : e;
      });
      setMembers(fresh);
      return fresh;
    }
    return members;
  }, [members]);

  return { members, setMembers, saveSlot, saveSlotNow, refetch, ready, dbError };
}
