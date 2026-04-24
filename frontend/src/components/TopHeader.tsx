import { useState, useEffect } from "react";
import { triggerLogout } from "@/App";
import { LogOut } from "lucide-react";

const TopHeader = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const mytTime = time.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <header className="h-12 border-b border-border bg-card/50 backdrop-blur-sm flex items-center px-6 shrink-0 relative">
      <h1 className="font-display text-sm font-bold tracking-[0.15em] text-foreground absolute left-1/2 -translate-x-1/2">
        VANGUARD
      </h1>
      <div className="ml-auto flex items-center gap-4">
        <span className="font-mono text-xs text-muted-foreground tracking-wider">
          MYT {mytTime}
        </span>
        <button
          onClick={triggerLogout}
          title="Log out"
          className="flex items-center gap-1.5 px-2 py-1 font-mono text-[9px] tracking-wider uppercase
            text-muted-foreground/60 border border-border/40 hover:border-destructive/50
            hover:text-destructive/80 hover:bg-destructive/5 transition-all duration-200"
        >
          <LogOut size={10} />
          EXIT
        </button>
      </div>
    </header>
  );
};

export default TopHeader;
