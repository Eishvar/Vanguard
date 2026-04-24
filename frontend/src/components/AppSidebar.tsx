import { Map } from "lucide-react";

const AppSidebar = () => {
  return (
    <aside className="w-14 border-r border-border bg-sidebar flex flex-col items-center py-4 shrink-0">
      <div className="font-display text-[10px] font-bold text-primary tracking-wider mb-8">
        V
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        <div
          title="Tactical"
          className="w-10 h-10 flex items-center justify-center
            bg-primary/15 text-primary border border-primary/30"
        >
          <Map size={18} />
        </div>
      </nav>
    </aside>
  );
};

export default AppSidebar;