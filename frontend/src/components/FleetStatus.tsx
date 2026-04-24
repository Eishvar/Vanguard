import { useMissionStore, DRONE_COLORS } from "@/stores/missionStore";
import { Wifi, WifiOff } from "lucide-react";

const FleetStatus = () => {
  const drones = useMissionStore((s) => s.drones);

  return (
    <div className="border border-border bg-card/50">
      <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
        <h3 className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Fleet Status
        </h3>
      </div>
      <div className="p-3 space-y-2">
        {drones.map((drone) => {
          const isOffline = drone.status === "offline";
          const droneColor = DRONE_COLORS[drone.id] ?? "text-foreground";

          return (
            <div
              key={drone.id}
              className={`p-3 border transition-colors ${
                isOffline
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-border bg-secondary/20"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {isOffline ? (
                    <WifiOff size={12} className="text-destructive" />
                  ) : (
                    <Wifi size={12} className="text-success" />
                  )}
                  <span className={`font-mono text-xs font-semibold ${
                    isOffline ? "text-destructive" : droneColor
                  }`}>
                    {drone.id}
                  </span>
                </div>
                <span className={`font-mono text-[9px] tracking-wider ${
                  isOffline ? "text-destructive" : "text-primary"
                }`}>
                  {drone.status.toUpperCase()}
                </span>
              </div>

              <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono mb-2">
                <span>SECTOR: {drone.sectorId >= 0 ? drone.sectorId : "—"}</span>
                <span className={isOffline ? "text-destructive" : ""}>{Math.round(drone.battery)}%</span>
              </div>

              {/* Battery bar */}
              <div className="h-1.5 bg-muted/50 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ease-linear ${
                    isOffline
                      ? "bg-destructive"
                      : drone.battery > 30
                      ? "bg-primary"
                      : "bg-warning"
                  }`}
                  style={{ width: `${Math.min(100, drone.battery)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FleetStatus;
