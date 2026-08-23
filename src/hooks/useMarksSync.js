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
