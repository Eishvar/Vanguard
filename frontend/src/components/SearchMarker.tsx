import { Marker } from "react-map-gl/maplibre";
import { useMissionStore } from "@/stores/missionStore";

export function SearchMarker() {
  const marker         = useMissionStore((s) => s.searchMarker);
  const setSearchMarker = useMissionStore((s) => s.setSearchMarker);

  if (!marker) return null;

  return (
    <Marker longitude={marker.lng} latitude={marker.lat} anchor="bottom">
      <div className="flex flex-col items-center">
        <div className="bg-slate-900/95 border border-amber-400 rounded px-2 py-1 text-[11px] font-mono text-amber-100 whitespace-nowrap">
          {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
          <button
            onClick={(e) => { e.stopPropagation(); setSearchMarker(null); }}
            className="ml-2 text-slate-400 hover:text-red-400"
          >×</button>
        </div>
        <div className="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-amber-400" />
      </div>
    </Marker>
  );
}
