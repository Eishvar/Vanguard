// frontend/src/components/TacticalMap.tsx

import { useState, useCallback, useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import Map, {
  Marker,
  NavigationControl,
  ScaleControl,
  Layer,
  Source,
} from 'react-map-gl/maplibre';
import type { MapRef, ViewStateChangeEvent } from 'react-map-gl/maplibre';
import { User, Play, Zap, ChevronDown } from 'lucide-react';

import { useMissionStore } from '@/stores/missionStore';
import { tileCenter, LNG_PER_M } from '@/lib/geoGrid';
import { baseStationLatLng } from '@/lib/terrainGeo';
import { VECTOR_STYLE_URL } from '@/lib/mapStyles';
import { TerrainOverlay } from '@/components/TerrainOverlay';
import { SectorOverlay } from '@/components/SectorOverlay';
import { DronePathOverlay } from '@/components/DronePathOverlay';
import { DroneNodeOverlay } from '@/components/DroneNodeOverlay';
import { TransitOverlay } from '@/components/TransitOverlay';
import { TerrainLegend } from '@/components/TerrainLegend';
import { NetworkOverlay } from '@/components/NetworkOverlay';
import { DroneIcon } from '@/components/DroneIcon';
import { MeasureTool } from '@/components/MeasureTool';
import type { MeasurePoint } from '@/components/MeasureTool';
import { DroneDetailCard } from '@/components/DroneDetailCard';
import { BoundaryOverlay } from '@/components/BoundaryOverlay';
import { BaseStationMarker } from '@/components/BaseStationMarker';
import { SearchBar } from '@/components/SearchBar';
import { SearchMarker } from '@/components/SearchMarker';

// Spread the 3 drones 6 m apart along the longitude axis before launch.
// Centered on tile (0,0) center: [center-6m, center, center+6m] — no latitude spread.
// 6 m * LNG_PER_M ≈ 0.000054° — all three stay well within the 100 m tile width.
const PRE_LAUNCH_LNG_DELTA   = 6 * LNG_PER_M;
const PRE_LAUNCH_LNG_OFFSETS = [-PRE_LAUNCH_LNG_DELTA, 0, PRE_LAUNCH_LNG_DELTA] as const;

const INJECT_OPTIONS = [
  { label: "Inject: Drone A", droneId: "DRONE_A" },
  { label: "Inject: Drone B", droneId: "DRONE_B" },
  { label: "Inject: Drone C", droneId: "DRONE_C" },
];

const MAP_MODE_OPTIONS = [
  { value: "none",      label: "DEFAULT"   },
  { value: "elevation", label: "ELEVATION" },
  { value: "density",   label: "DENSITY"   },
] as const;

// ─── Initial camera state ─────────────────────────────────────────────────────

const INITIAL_VIEW = {
  longitude: 110,   // centered on SE Asia for demo relevance
  latitude:  20,    // slightly north of equator
  zoom:      1.5,   // globe-level zoom — full Earth visible
  pitch:     0,
  bearing:   0,
};

// ─── Main component ────────────────────────────────────────────────────────────

const TacticalMap = () => {
  const mapRef = useRef<MapRef>(null);

  // Store state
  const drones               = useMissionStore((s) => s.drones);
  const survivorsFoundList   = useMissionStore((s) => s.survivorsFoundList);
  const showNetwork          = useMissionStore((s) => s.showNetwork);
  const commsNetwork         = useMissionStore((s) => s.commsNetwork);
  const toggleShowNetwork    = useMissionStore((s) => s.toggleShowNetwork);
  const lastReasoningByDrone = useMissionStore((s) => s.lastReasoningByDrone);
  const cfg             = useMissionStore((s) => s.terrainConfig);
  const dronePositions  = useMissionStore((s) => s.dronePositionsLatLng);
  const droneHeadings   = useMissionStore((s) => s.droneHeadings);
  const showDronePaths  = useMissionStore((s) => s.showDronePaths);
  const showNodes         = useMissionStore((s) => s.showNodes);
  const showTransitPaths  = useMissionStore((s) => s.showTransitPaths);
  const sectorsGeoJSON    = useMissionStore((s) => s.sectorsGeoJSON);
  const missionStarted    = useMissionStore((s) => s.missionStarted);
  const mapMode           = useMissionStore((s) => s.mapMode);
  const setMapMode        = useMissionStore((s) => s.setMapMode);
  const showSectors       = useMissionStore((s) => s.showSectorOverlay);
  const toggleSectors     = useMissionStore((s) => s.toggleSectorOverlay);
  const showPaths         = useMissionStore((s) => s.showDronePaths);
  const togglePaths       = useMissionStore((s) => s.toggleDronePaths);
  const showNodes2        = useMissionStore((s) => s.showNodes);
  const toggleNodes2      = useMissionStore((s) => s.toggleNodes);
  const showTransit       = useMissionStore((s) => s.showTransitPaths);
  const toggleTransit     = useMissionStore((s) => s.toggleTransitPaths);
  const terrainReady      = useMissionStore((s) => s.terrainReady);
  const terrainConfig     = useMissionStore((s) => s.terrainConfig);

  // Local UI state
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [measureActive, setMeasureActive] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<MeasurePoint[]>([]);
  const [selectedDroneId, setSelectedDroneId] = useState<string | null>(null);
  const [selectedSurvivorId, setSelectedSurvivorId] = useState<string | null>(null);

  // Inject failure dropdown state
  const [injectOpen, setInjectOpen]     = useState(false);
  const [injectedDrone, setInjectedDrone] = useState<string | null>(null);
  const injectRef = useRef<HTMLDivElement>(null);

  // Map mode dropdown state
  const [mapModeOpen, setMapModeOpen] = useState(false);
  const mapModeRef = useRef<HTMLDivElement>(null);

  // ── Pre-launch: fetch terrain config so boundary + base marker work before mission ──

  useEffect(() => {
    fetch("http://localhost:8000/api/config/terrain")
      .then((r) => r.json())
      .then((data) => {
        if (useMissionStore.getState().terrainConfig) return; // don't overwrite live config
        useMissionStore.getState().setTerrainConfig({
          anchorLat:    data.anchor_latlng[0],
          anchorLng:    data.anchor_latlng[1],
          gridN:        data.grid_n,
          tileM:        data.tile_m,
          obstacleElev: data.obstacle_elev_threshold,
        });
      })
      .catch((err) => console.warn("Failed to fetch terrain config:", err));
  }, []);

  // ── Close dropdowns on outside click ─────────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (injectRef.current && !injectRef.current.contains(e.target as Node))
        setInjectOpen(false);
      if (mapModeRef.current && !mapModeRef.current.contains(e.target as Node))
        setMapModeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Measure tool handlers ──────────────────────────────────────────────────

  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (measureActive) {
      setMeasurePoints((pts) => [...pts, { lat: e.lngLat.lat, lng: e.lngLat.lng }]);
      return;
    }
    setSelectedDroneId(null);
    setSelectedSurvivorId(null);
  }, [measureActive]);

  const handleToggleMeasure = useCallback(() => {
    setMeasureActive((v) => !v);
  }, []);

  const handleRemoveLastPoint = useCallback(() => {
    setMeasurePoints((pts) => pts.slice(0, -1));
  }, []);

  const handleClearMeasure = useCallback(() => {
    setMeasureActive(false);
    setMeasurePoints([]);
  }, []);

  // ── Camera pitch toggle (2D / 3D) ─────────────────────────────────────────

  const handleSetPitch = useCallback((pitch: number) => {
    mapRef.current?.easeTo({ pitch, duration: 500 });
    setViewState((v) => ({ ...v, pitch }));
  }, []);

  const flyToSimple = useCallback((lat: number, lng: number, zoom = 14) => {
    mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 1200, essential: true });
  }, []);

  const flyToBase = useCallback(() => {
    const storeCfg = useMissionStore.getState().terrainConfig;
    if (!storeCfg) return;
    const [lat, lng] = baseStationLatLng(storeCfg);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15, duration: 1200, essential: true });
  }, []);



  // ── Initial camera: fly to base station when config is first available ────

  useEffect(() => {
    if (cfg && mapRef.current) {
      const [lat, lng] = baseStationLatLng(cfg);
      mapRef.current.flyTo({ center: [lng, lat], zoom: 14, duration: 800 });
    }
  }, [cfg]);

  // ── Selected drone detail card ────────────────────────────────────────────

  const selectedDrone = selectedDroneId ? (drones.find((d) => d.id === selectedDroneId) ?? null) : null;
  const _selPos       = selectedDroneId ? dronePositions[selectedDroneId] : null;
  const selectedDroneCenter = _selPos ? { lat: _selPos[0], lng: _selPos[1] } : null;

  // ── Hovered drone hover card ───────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full overflow-hidden">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(e: ViewStateChangeEvent) => setViewState(e.viewState)}
        mapStyle={VECTOR_STYLE_URL}
        projection="globe"
        antialias={false}             // major perf win on Intel iGPU
        fadeDuration={0}              // no tile crossfade overhead
        renderWorldCopies={false}     // don't render world duplicates
        maxPitch={50}                 // cap pitch — prevents tile count explosion
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}    // we add custom attribution
        onClick={handleMapClick}
      >
        {/* Navigation controls (zoom +/-, compass) */}
        <NavigationControl position="bottom-right" />
        <ScaleControl position="bottom-right" unit="metric" />

        {/* ── Pre-launch boundary rectangle (hidden after terrain_initialized) ── */}
        <BoundaryOverlay />

        {/* ── Terrain tile fills (elevation or density) ── */}
        <TerrainOverlay />

        {/* ── Sector polygon borders + labels ── */}
        <SectorOverlay />

        {/* ── Network overlay — comm-range rings + animated link arrows ── */}
        <NetworkOverlay hoveredEntityId={null} />

        {/* ── Lawnmower paths, handoff marker, and sweep node dots ── */}
        {showDronePaths && cfg && sectorsGeoJSON && <DronePathOverlay />}
        {showNodes && cfg && sectorsGeoJSON && <DroneNodeOverlay />}
        {showTransitPaths && cfg && <TransitOverlay />}

        {/* ── Survivor markers ── */}
        {survivorsFoundList.map((record) => {
          if (!cfg) return null;
          const parts = record.tile_id?.match(/^r(\d+)_c(\d+)$/);
          if (!parts) return null;
          const center = tileCenter(parseInt(parts[1]), parseInt(parts[2]), cfg);
          const isSelected = selectedSurvivorId === record.tile_id;
          return (
            <Marker
              key={`survivor-${record.tile_id}`}
              longitude={center.lng}
              latitude={center.lat}
            >
              <div
                className="flex flex-col items-center cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSurvivorId((prev) => prev === record.tile_id ? null : record.tile_id);
                  setSelectedDroneId(null);
                }}
              >
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                  ${isSelected
                    ? 'bg-amber-400/60 border-amber-300 scale-125'
                    : 'bg-amber-400/30 border-amber-400 animate-pulse'}`}
                >
                  <User size={12} className="text-amber-400" />
                </div>
              </div>
            </Marker>
          );
        })}

        {/* ── Survivor click popup ── */}
        {selectedSurvivorId && (() => {
          const rec = survivorsFoundList.find((r) => r.tile_id === selectedSurvivorId);
          if (!rec || !cfg) return null;
          const parts = rec.tile_id?.match(/^r(\d+)_c(\d+)$/);
          if (!parts) return null;
          const center = tileCenter(parseInt(parts[1]), parseInt(parts[2]), cfg);
          const priority = rec.survivor_profile?.medical_priority ?? "UNKNOWN";
          const priorityColor: Record<string, string> = {
            CRITICAL: "text-red-400 border-red-500/50",
            HIGH:     "text-orange-400 border-orange-500/50",
            MODERATE: "text-yellow-400 border-yellow-500/50",
            LOW:      "text-green-400 border-green-500/50",
          };
          const cls = priorityColor[priority] ?? "text-muted-foreground border-border";
          return (
            <Marker key="survivor-popup" longitude={center.lng} latitude={center.lat} anchor="bottom" offset={[0, -28]}>
              <div className="bg-[#0d1520] border border-amber-900/60 font-mono text-[10px] w-[180px] shadow-xl shadow-black/60 pointer-events-none">
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-amber-900/40">
                  <span className="text-amber-400 tracking-[0.15em] text-[10px] uppercase">SURVIVOR</span>
                  <span className={`border px-1.5 py-0.5 text-[9px] tracking-[0.1em] uppercase ${cls}`}>
                    {priority}
                  </span>
                </div>
                <div className="px-2.5 py-2 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500 uppercase tracking-[0.1em]">Lat</span>
                    <span className="text-slate-300 tabular-nums">{center.lat.toFixed(5)}°</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 uppercase tracking-[0.1em]">Lng</span>
                    <span className="text-slate-300 tabular-nums">{center.lng.toFixed(5)}°</span>
                  </div>
                </div>
              </div>
            </Marker>
          );
        })()}

        {/* ── Drone markers — position exclusively from dronePositionsLatLng ── */}
        {drones.map((drone, droneIdx) => {
          const pos = dronePositions[drone.id];
          if (!pos && !cfg) return null;
          let lat: number, lng: number;
          if (pos) {
            lat = pos[0];
            lng = pos[1];
          } else {
            const base = tileCenter(0, 0, cfg!);
            lat = base.lat;
            lng = base.lng + (PRE_LAUNCH_LNG_OFFSETS[droneIdx] ?? 0);
          }
          const heading = droneHeadings[drone.id] ?? 0;
          const isOffline  = drone.status === 'offline';
          const isIsolated = commsNetwork?.isolated?.includes(drone.id) ?? false;
          return (
            <Marker
              key={drone.id}
              longitude={lng}
              latitude={lat}
              anchor="center"
            >
              <div
                onClick={(e) => { e.nativeEvent.stopPropagation(); setSelectedDroneId((prev) => prev === drone.id ? null : drone.id); }}
                style={{ transform: `rotate(${heading}deg)`, cursor: 'pointer' }}
              >
                <DroneIcon
                  droneId={drone.id}
                  isOffline={isOffline}
                  isIsolated={isIsolated}
                  zoom={viewState.zoom}
                />
              </div>
            </Marker>
          );
        })}

        {/* ── Base station marker — always visible once config is loaded ── */}
        <BaseStationMarker />

        {/* ── Search coordinate pin ── */}
        <SearchMarker />

        {/* ── Drone detail card popup ── */}
        {selectedDrone && selectedDroneCenter && (
          <DroneDetailCard
            drone={selectedDrone}
            longitude={selectedDroneCenter.lng}
            latitude={selectedDroneCenter.lat}
            reasoning={lastReasoningByDrone[selectedDrone.id] ?? ''}
            onClose={() => setSelectedDroneId(null)}
          />
        )}

        {/* ── Drone hover card — only when hovering a drone that isn't selected ── */}


        {/* ── 3D buildings — always active on OpenFreeMap vector style ── */}
        <Layer
          id="3d-buildings"
          source="openmaptiles"
          source-layer="building"
          type="fill-extrusion"
          minzoom={14}
          maxzoom={17}
          paint={{
            'fill-extrusion-color': '#1e293b',
            'fill-extrusion-height': [
              'coalesce',
              ['*', ['get', 'building:levels'], 3.5],
              ['get', 'render_height'],
              8,
            ],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.75,
          }}
          filter={['>', ['coalesce', ['get', 'render_height'], 8], 5]}
        />

        {/* ── Measure distance tool ── */}
        <MeasureTool
          active={measureActive}
          points={measurePoints}
          onRemoveLast={handleRemoveLastPoint}
          onClear={handleClearMeasure}
        />
      </Map>

      {/* ── HUD overlay elements ── */}
      <TerrainLegend />

      {/* ── Search bar — top-left only ── */}
      <div className="absolute top-0 left-0 z-10 pointer-events-auto"
           style={{ transform: 'scale(0.65)', transformOrigin: 'top left' }}>
        <SearchBar onFlyTo={flyToSimple} />
      </div>

      {/* ── Right control panel — top-right ──────────────────────────────────
       *
       *  Layout (top → bottom):
       *    Launch Mission · Inject Failure · 2D/3D · Map Layers dropdown
       *
       *  HOW TO ADJUST:
       *    • Panel position  → change `top-X right-X` on the outer div
       *    • Panel width     → change `w-44` on the outer div
       *    • Gap             → change `gap-1.5`
       *    • Button size     → change `text-[10px]` / `px-X py-X` per button
       */}
      <div className="absolute top-2 right-4 z-10 flex flex-col gap-1.5 w-44 pointer-events-auto">

        {/* Launch Mission */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('vanguard:launch'))}
          disabled={missionStarted}
          className="flex items-center justify-center gap-2 px-3 py-2
            bg-primary/15 border border-primary/40 text-primary font-mono text-[10px]
            tracking-wider uppercase hover:bg-primary/25 transition-colors
            disabled:opacity-30 disabled:pointer-events-none"
        >
          <Play size={10} />
          {missionStarted ? 'RUNNING...' : '🚀 LAUNCH MISSION'}
        </button>

        {/* Inject Failure */}
        <div className="relative" ref={injectRef}>
          <button
            onClick={() => setInjectOpen((o) => !o)}
            disabled={!missionStarted}
            className="w-full flex items-center justify-between px-3 py-2
              border border-destructive/30 bg-destructive/5 font-mono text-[10px]
              tracking-wider uppercase text-destructive/70
              hover:bg-destructive/15 hover:border-destructive/60 hover:text-destructive
              transition-colors disabled:opacity-25 disabled:pointer-events-none"
          >
            <div className="flex items-center gap-2">
              <Zap size={10} />
              <span>{injectedDrone ? `INJECTED: ${injectedDrone.replace('DRONE_', '')}` : 'INJECT FAILURE'}</span>
            </div>
            <ChevronDown size={10} className={`transition-transform ${injectOpen ? 'rotate-180' : ''}`} />
          </button>
          {injectOpen && (
            <div className="absolute z-50 top-full left-0 right-0 mt-0.5
              border border-destructive/30 bg-card shadow-lg">
              {INJECT_OPTIONS.map((opt) => (
                <button
                  key={opt.droneId}
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('vanguard:inject', { detail: opt.droneId }));
                    setInjectedDrone(opt.droneId);
                    setInjectOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase
                    text-destructive/70 hover:bg-destructive/15 hover:text-destructive transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 2D / 3D */}
        <div className="flex gap-1">
          <button
            onClick={() => handleSetPitch(0)}
            className={`flex-1 px-2 py-1.5 text-[10px] font-mono border rounded transition-colors
              ${viewState.pitch === 0
                ? 'bg-teal-500/20 border-teal-400 text-teal-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-teal-500/50'}`}
          >2D</button>
          <button
            onClick={() => handleSetPitch(45)}
            className={`flex-1 px-2 py-1.5 text-[10px] font-mono border rounded transition-colors
              ${viewState.pitch > 0
                ? 'bg-teal-500/20 border-teal-400 text-teal-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-teal-500/50'}`}
          >3D</button>
        </div>

        {/* Map Layers dropdown — all toggles */}
        <div className="relative" ref={mapModeRef}>
          <button
            onClick={() => setMapModeOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-1.5
              bg-slate-900/80 border border-slate-600 text-slate-300 font-mono text-[10px]
              tracking-wider uppercase hover:border-teal-500/50 transition-colors"
          >
            <span>MAP LAYERS</span>
            <ChevronDown size={10} className={`transition-transform ${mapModeOpen ? 'rotate-180' : ''}`} />
          </button>

          {mapModeOpen && (
            <div className="absolute z-50 top-full left-0 right-0 mt-0.5
              border border-slate-600 bg-card shadow-lg flex flex-col">

              {/* HOME — fly to base */}
              <button
                onClick={() => { flyToBase(); setMapModeOpen(false); }}
                disabled={!terrainConfig}
                className="w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase
                  text-amber-400/80 hover:bg-slate-700/50 hover:text-amber-300 transition-colors
                  disabled:opacity-30 disabled:pointer-events-none"
              >🎯 HOME</button>

              {/* NETWORK */}
              <button
                onClick={toggleShowNetwork}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${showNetwork ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >📡 NETWORK {showNetwork ? '✓' : ''}</button>

              {/* MEASURE */}
              <button
                onClick={() => { handleToggleMeasure(); setMapModeOpen(false); }}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${measureActive ? 'text-amber-300 bg-amber-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >📏 MEASURE {measureActive ? '✓' : ''}</button>

              {/* ELEVATION */}
              <button
                disabled={!terrainReady}
                onClick={() => setMapMode(mapMode === 'elevation' ? 'none' : 'elevation')}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${!terrainReady ? 'opacity-30 pointer-events-none' : ''}
                  ${mapMode === 'elevation' ? 'text-yellow-300 bg-yellow-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >🏔 ELEVATION {mapMode === 'elevation' ? '✓' : ''}</button>

              {/* DENSITY */}
              <button
                disabled={!terrainReady}
                onClick={() => setMapMode(mapMode === 'density' ? 'none' : 'density')}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${!terrainReady ? 'opacity-30 pointer-events-none' : ''}
                  ${mapMode === 'density' ? 'text-blue-300 bg-blue-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >🏘 DENSITY {mapMode === 'density' ? '✓' : ''}</button>

              {/* SECTORS */}
              <button
                disabled={!terrainReady}
                onClick={toggleSectors}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${!terrainReady ? 'opacity-30 pointer-events-none' : ''}
                  ${showSectors ? 'text-violet-300 bg-violet-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >⬡ SECTORS {showSectors ? '✓' : ''}</button>

              {/* PATHS */}
              <button
                disabled={!terrainReady}
                onClick={togglePaths}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${!terrainReady ? 'opacity-30 pointer-events-none' : ''}
                  ${showPaths ? 'text-indigo-300 bg-indigo-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >〰 PATHS {showPaths ? '✓' : ''}</button>

              {/* NODES */}
              <button
                disabled={!terrainReady}
                onClick={toggleNodes2}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${!terrainReady ? 'opacity-30 pointer-events-none' : ''}
                  ${showNodes2 ? 'text-emerald-300 bg-emerald-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >● NODES {showNodes2 ? '✓' : ''}</button>

              {/* TRANSIT */}
              <button
                disabled={!terrainReady}
                onClick={toggleTransit}
                className={`w-full text-left px-3 py-1.5 font-mono text-[9px] tracking-wider uppercase transition-colors
                  ${!terrainReady ? 'opacity-30 pointer-events-none' : ''}
                  ${showTransit ? 'text-orange-300 bg-orange-500/10' : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'}`}
              >➜ TRANSIT {showTransit ? '✓' : ''}</button>


            </div>
          )}
        </div>
      </div>

      {/* Scanline overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-20"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.02) 2px, rgba(0,0,0,0.02) 4px)',
        }}
      />
    </div>
  );
};

export default TacticalMap;
