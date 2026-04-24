import { Marker } from "react-map-gl/maplibre";
import { useMissionStore } from "@/stores/missionStore";
import { baseStationLatLng } from "@/lib/terrainGeo";

export function BaseStationMarker() {
  const cfg = useMissionStore((s) => s.terrainConfig);
  if (!cfg) return null;
  const [lat, lng] = baseStationLatLng(cfg);

  return (
    <Marker longitude={lng} latitude={lat} anchor="bottom">
      <div className="flex flex-col items-center pointer-events-none select-none">
        <div className="bg-slate-900/90 border border-amber-400 rounded px-2 py-0.5 text-[11px] font-mono text-amber-200 whitespace-nowrap">
          📡 BASE
        </div>
        <div className="w-0.5 h-2 bg-amber-400" />
      </div>
    </Marker>
  );
}
