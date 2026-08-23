import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

export function usePresence(me) {
  const [online, setOnline] = useState([]);
  
  useEffect(() => {
    const name = typeof me === "string" ? me : me?.name;
    const slot = typeof me === "object" ? me?.slot : null;
    
    if (!supabase || !name || !name.trim()) return;
    
    const cleanName = name.trim();
    const presenceKey = slot != null ? `slot-${slot}:${cleanName}` : cleanName;

    const parseState = (state) => {
      const names = [];
      for (const [key, presences] of Object.entries(state)) {
        if (presences && presences.length > 0) {
          const pName = presences[0].name || key.split(":").pop();
          if (pName && !names.includes(pName)) {
            names.push(pName);
          }
        }
      }
      return names;
    };

    const ch = supabase.channel("team-presence", { config: { presence: { key: presenceKey } } })
      .on("presence", { event: "sync" }, () => setOnline(parseState(ch.presenceState())))
      .on("presence", { event: "leave" }, () => setOnline(parseState(ch.presenceState())))
      .subscribe(status => {
        if (status === "SUBSCRIBED") {
          ch.track({ name: cleanName, slot });
        }
      });

    const handleBeforeUnload = () => {
      ch.untrack();
      supabase.removeChannel(ch);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      ch.untrack();
      supabase.removeChannel(ch);
    };
  }, [me]);

  return online;
}
