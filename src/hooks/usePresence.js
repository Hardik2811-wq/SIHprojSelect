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
