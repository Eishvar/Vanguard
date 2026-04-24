import React from "react";

interface HudPanelProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function HudPanel({ title, children, className = "" }: HudPanelProps) {
  return (
    <div className={`hud-border hud-corner-bottom relative bg-card/50 border border-border/50 ${className}`}>
      {title && (
        <div className="px-4 py-2 border-b border-border/30 text-primary font-display text-sm tracking-wider uppercase">
          {title}
        </div>
      )}
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}
