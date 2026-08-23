import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";

export function usePresence(myName) {
  const [online, setOnline] = useState([]);
  useEffect(() => {
    if (!supabase || !myName || !myName.trim()) return;
    const cleanName = myName.trim();
    const ch = supabase.channel("team-presence", { config: { presence: { key: cleanName } } })
      .on("presence", { event: "sync" }, () => setOnline(Object.keys(ch.presenceState())))
      .subscribe(status => { if (status === "SUBSCRIBED") ch.track({ name: cleanName }); });
    return () => supabase.removeChannel(ch);
  }, [myName]);
  return online;
}
