import { useState } from "react";
import { useMissionStore } from "@/stores/missionStore";

interface SearchBarProps {
  onFlyTo: (lat: number, lng: number) => void;
}

export function SearchBar({ onFlyTo }: SearchBarProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setSearchMarker = useMissionStore((s) => s.setSearchMarker);

  const parse = (s: string): { lat: number; lng: number } | null => {
    const cleaned = s.trim().replace(/[,;\s]+/g, " ");
    const parts = cleaned.split(" ").map((p) => parseFloat(p));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
    const [lat, lng] = parts;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
  };

  const handleSubmit = (e?: React.FormEvent | React.KeyboardEvent) => {
    e?.preventDefault?.();
    const parsed = parse(value);
    if (!parsed) {
      setError("Use format: lat, lng  (e.g. 5.9362, 116.6582)");
      return;
    }
    setError(null);
    setSearchMarker(parsed);
    onFlyTo(parsed.lat, parsed.lng);
  };

  return (
    <div className="absolute top-16 left-4 z-10 w-80">
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Search coordinates (e.g. 5.9362, 116.6582)"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(e); }}
          className="w-full px-3 py-2 rounded-md bg-slate-900/90 border border-slate-600 text-slate-100 placeholder-slate-400 font-mono text-sm focus:outline-none focus:border-amber-400"
        />
      </form>
      {error && (
        <div className="mt-1 px-2 py-1 text-[11px] bg-red-900/80 text-red-200 rounded">
          {error}
        </div>
      )}
    </div>
  );
}
