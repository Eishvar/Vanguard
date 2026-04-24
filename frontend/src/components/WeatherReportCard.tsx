import { Wind, Thermometer, Eye, Droplets, Activity } from "lucide-react";

interface WeatherField {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit: string;
  status?: "nominal" | "caution" | "critical";
}

const WEATHER_DATA: WeatherField[] = [
  { icon: <Wind size={13} />,        label: "Wind Speed",   value: "14",  unit: "kts",  status: "nominal" },
  { icon: <Activity size={13} />,    label: "Wind Dir",     value: "NNE", unit: "220°", status: "nominal" },
  { icon: <Thermometer size={13} />, label: "Temperature",  value: "28",  unit: "°C",   status: "nominal" },
  { icon: <Eye size={13} />,         label: "Visibility",   value: "8.0", unit: "km",   status: "nominal" },
  { icon: <Droplets size={13} />,    label: "Humidity",     value: "74",  unit: "%",    status: "caution" },
];

const STATUS_COLOR: Record<string, string> = {
  nominal:  "text-teal-400",
  caution:  "text-amber-400",
  critical: "text-red-400",
};

const WeatherReportCard = () => {
  return (
    <div className="bg-card/30 border-b border-border" style={{ flex: "0 0 auto" }}>
      {/* Header */}
      <div className="px-4 py-2 border-b border-border bg-secondary/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wind size={11} className="text-cyan-400" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Weather Report
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
          <span className="font-mono text-[8px] text-muted-foreground/60 uppercase tracking-wider">
            Live
          </span>
        </div>
      </div>

      {/* Weather grid */}
      <div className="px-4 py-3 grid grid-cols-5 gap-3">
        {WEATHER_DATA.map(({ icon, label, value, unit, status = "nominal" }) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-muted-foreground/50">
              {icon}
              <span className="font-mono text-[8px] uppercase tracking-wider truncate">{label}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`font-mono text-[18px] font-bold leading-none ${STATUS_COLOR[status]}`}>
                {value}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/60">{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Condition summary */}
      <div className="px-4 pb-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-border/50" />
        <span className="font-mono text-[8px] text-muted-foreground/40 uppercase tracking-[0.2em]">
          Conditions: VFR · Slight turbulence above 500m AGL
        </span>
        <div className="h-px flex-1 bg-border/50" />
      </div>
    </div>
  );
};

export default WeatherReportCard;
