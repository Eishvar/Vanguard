# ARCHITECTURE — OVERVIEW
> **Always read this file at session start. Read the domain files below only when relevant.**

---

## Domain Files (read on-demand)

| File | Read when... |
|------|-------------|
| `docs/arch/BACKEND.md` | Touching Python backend — simulation, agents, MCP, orchestrator, API server |
| `docs/arch/FRONTEND.md` | Touching React/TypeScript frontend — components, store, data flow |
| `docs/arch/EVENTS.md` | Touching SSE events, MissionControls SSE listeners, or event payloads |
| `docs/arch/LOG.md` | Checking what phases are complete and what changed in each |

---

## 1. Project Overview

VANGUARD is a full-stack multi-agent AI simulation of a search-and-rescue (SAR) drone swarm. Three drones sweep a 20×20 tile terrain grid as pure path-followers — no per-round LLM call. A supervisor LLM orchestrates fleet planning (sector assignment), monitors progress each round, and triggers self-healing redistribution when a drone fails. Every movement and scan streams live to a dark-themed React dashboard via Server-Sent Events.

The system demonstrates: supervisor/worker role separation, self-healing coordination via LLM reasoning, structured output enforcement (Pydantic schemas), and real-time SSE streaming from backend to frontend.

---

## 2. Full File Structure

### Backend (`backend/`)

```
backend/
├── __init__.py                 # Empty package marker
├── .env                        # API keys: SUPERVISOR_MODEL, WORKER_MODEL, OPENROUTER_API_KEY
├── config.py                   # Shared constants (MCP_URL, BATTERY_*, COMM_RADIUS_KM, etc.)
├── terrain.py                  # Terrain analysis, sector clustering, and lawnmower path generation (offline, deterministic)
├── api_server.py               # FastAPI app — HTTP endpoints + SSE stream
├── test_run.py                 # CLI runner — runs mission without API server
├── test_fast.py                # Mock-mode fast test — validates full pipeline, no API calls
├── test_mcp.py                 # MCP connectivity smoke-test
├── test_battery_feasibility.py # Standalone battery feasibility test across normal and drone-failure scenarios
├── agent/
│   ├── __init__.py             # Empty package marker
│   ├── drone_agent.py          # DroneAgent class — pure terrain path-follower (no LLM)
│   ├── llm_client.py           # Unified LLM call wrapper (LiteLLM + retry + token tracking)
│   ├── orchestrator.py         # Orchestrator — mission lifecycle controller + MissionLogger
│   ├── pathfinding.py          # Dijkstra shortest-path utilities for inter-sector drone transit waypoints
│   ├── prompts.py              # Supervisor-only system prompt + monitor/summary templates
│   ├── schemas.py              # Pydantic models for all LLM structured outputs
│   ├── sector_assignment.py    # Greedy battery-feasible sector assignment — validates LLM proposals, fallback replan on failure
│   └── supervisor.py           # SupervisorAgent — plan/monitor/redistribute/summarise
├── scripts/
│   ├── fetch_buildings.py      # One-time script: queries Overpass API for OSM building footprints, outputs density grid JSON
│   ├── fetch_elevation.py      # One-time script: crops SRTM GeoTIFF to mission area, outputs 20×20 elevation grid JSON
│   ├── rebuild_terrain.py      # One-shot terrain data rebuild after changing anchor or grid constants in config.py
│   └── render_sector_paths.py  # Visual smoke test: renders sector polygons + lawnmower paths to debug PNG
└── server/
    ├── __init__.py             # Empty package marker
    ├── comms.py                # compute_comm_network() — mesh graph + BFS reachability
    ├── game_state.py           # Async-safe GameState wrapper (asyncio.Lock)
    ├── mcp_server.py           # FastMCP server — 12 tools over Streamable HTTP
    └── simulation.py           # SimulationCore — pure Python grid/drone/mission state
```

### Frontend (`frontend/`)

```
frontend/
├── package.json                # Dependencies (React 18, Zustand, Vite, shadcn/ui, maplibre-gl, react-map-gl)
├── vite.config.ts              # Vite config — port 8080, @ alias → src/
├── vitest.config.ts            # Vitest config — jsdom, globals, setup file
├── tailwind.config.ts          # Tailwind theme — custom colors + font config
└── src/
    ├── main.tsx                # React entry — createRoot("#root").render(<App />)
    ├── App.tsx                 # Root — IntroSequence gate → BrowserRouter → Index
    ├── App.css                 # App-level CSS rules (Vite default, minimal)
    ├── index.css               # Global styles — CSS variables, fonts, utility classes
    ├── vite-env.d.ts           # Vite TypeScript ambient declarations for import.meta.env
    ├── assets/                 # Static image assets (satellite map previews, skynet logo)
    ├── pages/
    │   ├── Index.tsx           # Route "/" — renders <Dashboard />
    │   └── NotFound.tsx        # 404 fallback page for unmatched routes
    ├── stores/
    │   └── missionStore.ts     # Zustand store — all mission state + default data
    ├── components/
    │   ├── Dashboard.tsx       # Layout shell — sidebar + header + map or logs view
    │   ├── AppSidebar.tsx      # Left nav sidebar (Tactical/Logs page switch)
    │   ├── TopHeader.tsx       # Top bar — "VANGUARD" title + live MYT clock
    │   ├── TacticalMap.tsx     # MapLibre GL JS geospatial map — satellite + terrain + grid overlay
    │   ├── NetworkOverlay.tsx  # GeoJSON comm-range rings + animated bidirectional mesh arrows
    │   ├── TerrainOverlay.tsx  # GeoJSON tile fills coloured by elevation or density (config-driven)
    │   ├── DroneIcon.tsx       # SVG drone icon marker — 2D/3D view based on zoom threshold
    │   ├── BatteryIcon.tsx     # Reusable SVG battery fill icon — teal ≥20%, red <20%
    │   ├── DroneDetailCard.tsx # MapLibre Popup on drone click — telemetry card with live data
    │   ├── DroneNodeOverlay.tsx  # MapLibre overlay rendering per-sector sweep node waypoints (non-obstacle tiles only)
    │   ├── DronePathOverlay.tsx  # Lawnmower sweep paths with live progress + self-heal handoff split
    │   ├── HudPanel.tsx        # Reusable HUD panel container with optional title header and corner decorations
    │   ├── NavLink.tsx         # Thin wrapper around react-router-dom NavLink with active/pending className merging
    │   ├── PresetLocations.tsx # Dropdown to fly camera to preset disaster locations
    │   ├── MapHUD.tsx          # HUD overlay buttons: 2D/3D toggle, network toggle, grid lock, elevation/density/sectors/paths toggles
    │   ├── MeasureTool.tsx     # Distance measurement tool — click-to-place points, polyline + km label
    │   ├── MissionControls.tsx # Mission start button + SSE handler + failure inject
    │   ├── FleetStatus.tsx     # Right panel — per-drone status, cell, battery bar
    │   ├── SectorCoverage.tsx  # Right panel — per-quadrant scan progress bars
    │   ├── SectorOverlay.tsx   # MapLibre GeoJSON overlay rendering sector polygon fills and centroid labels
    │   ├── MissionIntel.tsx    # Right panel — survivors found counter
    │   ├── SurvivorPanel.tsx   # Right panel — survivor list sorted by priority; click row opens SurvivorReportCard overlay
    │   ├── SurvivorReportCard.tsx # Fullscreen overlay: priority badge, thermal image, AudioWaveform, data grid
    │   ├── AudioWaveform.tsx   # CSS-animated SVG bar chart; NW_3 (distressed) and SE_3 (regular) patterns only
    │   ├── MissionLogs.tsx     # 2-tab log viewer (Execution + Report); filter/search toolbar
    │   ├── LogEntry.tsx        # Single log row — source-aware icon+color
    │   ├── LiveCotPanel.tsx    # Per-drone last-reasoning strip
    │   ├── MissionReportView.tsx # Tab 3 markdown report renderer
    │   ├── IntroSequence.tsx   # Animated splash screen (glitch + split-screen)
    │   ├── TerrainLegend.tsx   # Map legend for elevation/density heatmaps — reads obstacleElev from terrainConfig
    │   ├── TransitOverlay.tsx  # MapLibre overlay rendering per-drone inter-sector transit polylines
    │   ├── BoundaryOverlay.tsx # Dashed amber 2km×2km rectangle; visible pre-launch only, hides on terrain_initialized
    │   ├── BaseStationMarker.tsx # 📡 BASE pin at tile (0,0) centre; always visible once terrainConfig is loaded
    │   ├── SearchBar.tsx       # Coordinate search input (lat,lng); flies camera and drops SearchMarker on submit
    │   ├── SearchMarker.tsx    # Dismissable amber pin at last searched coordinate
    │   └── ui/                 # Full shadcn/ui component library (Radix-based)
    ├── hooks/
    │   ├── use-mobile.tsx      # shadcn/ui mobile breakpoint hook
    │   ├── use-toast.ts        # shadcn/ui toast hook
    │   └── useInterpolatedPositions.ts  # RAF-based lat/lng tween hook — smooths drone marker movement
    ├── lib/
    │   ├── utils.ts            # cn() — clsx + tailwind-merge utility
    │   ├── geoGrid.ts          # Coordinate math: cell→lat/lng, grid anchor, GeoJSON polygon helpers
    │   ├── terrainGeo.ts       # Pure functions: local-metres→lat/lng, tile bounds — all take TerrainConfig arg
    │   └── mapStyles.ts        # MapLibre tile sources: EOX satellite, AWS terrain, OpenFreeMap vector
    └── test/
        ├── setup.ts            # Vitest setup
        └── example.test.ts     # Placeholder test
```

---

## 8. Running the Project

### Startup

```bash
cd ~/projects/Multi\ Agent\ LLM\ Drone\ Swarm/frontend && npm run start:all
```

### CLI test (no frontend, MCP server must be running)
```bash
cd backend
python test_run.py          # Full mission, prints events to stdout
MOCK_MODE=1 python test_fast.py   # Fast mock test — validates pipeline in <30s, no API calls
python test_mcp.py          # MCP connectivity smoke-test
```

### Required environment variables (`backend/.env`)
```bash
SUPERVISOR_MODEL=openrouter/x-ai/grok-4.1-fast   # Any LiteLLM-compatible string
WORKER_MODEL=openrouter/x-ai/grok-4.1-fast        # Any LiteLLM-compatible string
OPENROUTER_API_KEY=...                             # Required for openrouter/* models
# ANTHROPIC_API_KEY=...                            # Required for anthropic/* models
# OPENAI_API_KEY=...                               # Required for openai/* models
# MOCK_MODE=1                                      # Set to skip real LLM calls in tests
```

---

## 9. Grid Reference

20×20 tile grid. Each tile = `TILE_M × TILE_M` metres. SW-corner origin (row 0 = south, col 0 = west).
Base station at tile `(row=0, col=0)`. Local metres: `x = col × TILE_M` (east), `y = row × TILE_M` (north).
All grid constants come from `backend/config.py` — never hardcoded elsewhere.
