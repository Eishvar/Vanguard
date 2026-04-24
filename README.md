## 1. Tech Stack

### Backend

| Technology | Role in this project |
|---|---|
| **Python / FastAPI** | HTTP endpoints (`/start`, `/inject-failure`) and SSE stream (`/events`) that push real-time mission events to the browser |
| **FastMCP** | Model Context Protocol server on `localhost:8001` — exposes 13 tools (drone discovery, tile scanning, sector completion, fault injection) that the supervisor agent calls at runtime |
| **LiteLLM** | Unified async LLM wrapper — routes calls to any model string (`openrouter/*`, `anthropic/*`, `openai/*`) with retry, exponential backoff, and Anthropic prompt-cache headers |
| **Pydantic** | Enforces structured outputs for every LLM response (`SupervisorPlan`, `MissionSummary`) — invalid JSON is rejected and the call retries automatically |
| **uvicorn** | ASGI server running the FastAPI app on port 8000 with hot-reload |
| **asyncio** | Non-blocking orchestrator loop — drone sweeps, supervisor monitoring, and SSE emit run concurrently without threads |
| **SRTM / Overpass API** | One-time terrain data acquisition: 20×20 real-world elevation grid from SRTM GeoTIFF, building density grid from OpenStreetMap via Overpass |

### Frontend

| Technology | Role in this project |
|---|---|
| **React 18** | Component tree for the live mission dashboard — map overlays, drone cards, logs, survivor reports |
| **TypeScript** | End-to-end type safety; SSE payload types mirror backend Pydantic schemas |
| **Vite** | Dev server on port 8080 with HMR; single `npm run start:all` launches MCP + API + Web concurrently |
| **Zustand** | Single global `missionStore` — all drone positions, sector coverage, survivors, and comms state flow through here |
| **MapLibre GL JS / react-map-gl** | Satellite + terrain basemap with custom GeoJSON overlays: lawnmower paths, sector polygons, comm-range rings, drone markers |
| **Tailwind CSS + shadcn/ui** | Dark-themed military HUD aesthetic; Radix UI primitives for accessible dropdowns, panels, and tabs |
| **Framer Motion** | Animated glitch intro sequence on first load |

---

## 2. GitHub README

# VANGUARD — Multi-Agent LLM Drone Swarm

A full-stack AI simulation of a search-and-rescue drone swarm where a supervisor LLM orchestrates three drones across real terrain, self-heals on failures, and streams every decision live to a tactical dashboard.

---

---

## 3. Core Features

- Supervisor/worker role separation 
- Real terrain: SRTM elevation + OpenStreetMap building density over a 2km × 2km area
- Battery-feasible sector assignment with greedy fallback replan
- Live drone-failure injection with automatic sector redistribution
- Mesh communication network — comms-lost / comms-restored events when drones move out of range
- Survivor detection with priority triage (`CRITICAL` → `LOW`) and thermal reading
- SSE streaming — every backend event reaches the browser in <100ms
- Config-driven architecture — all grid/terrain constants in one `config.py`, zero hardcoding elsewhere
- Any LiteLLM-compatible model: OpenRouter, Anthropic, OpenAI, local models

---

## 4. Tech Stack

**Backend:** Python · FastAPI · FastMCP · LiteLLM · Pydantic · asyncio · uvicorn

**Frontend:** React 18 · TypeScript · Vite · Zustand · MapLibre GL JS · Tailwind CSS · shadcn/ui

---

## 5. Project Structure

```
backend/
├── config.py              # All shared constants (grid, battery, MCP URL)
├── terrain.py             # Sector clustering, lawnmower path generation (offline)
├── api_server.py          # FastAPI — HTTP + SSE stream on port 8000
├── agent/
│   ├── orchestrator.py    # Mission lifecycle controller — phases 1–7
│   ├── supervisor.py      # SupervisorAgent — plan / monitor / summarise via LLM
│   ├── drone_agent.py     # DroneAgent — pure path-follower, no LLM
│   ├── llm_client.py      # Unified LLM wrapper (LiteLLM + retry + token tracking)
│   ├── schemas.py         # Pydantic models for all LLM structured outputs
│   └── prompts.py         # Supervisor system prompt + monitor/summary templates
└── server/
    ├── mcp_server.py      # FastMCP server — 13 tools on port 8001
    ├── simulation.py      # Pure Python grid/drone/mission state
    ├── game_state.py      # Async-safe GameState wrapper
    └── comms.py           # Mesh comm-network graph + BFS reachability

frontend/src/
├── stores/missionStore.ts          # Zustand store — all mission state
├── components/
│   ├── MissionControls.tsx         # Start button + SSE event handler
│   ├── TacticalMap.tsx             # MapLibre satellite map
│   ├── DronePathOverlay.tsx        # Lawnmower paths + self-heal handoff split
│   ├── NetworkOverlay.tsx          # Comm-range rings + mesh arrows
│   ├── FleetStatus.tsx             # Per-drone telemetry cards
│   └── SurvivorReportCard.tsx      # Priority triage overlay with thermal data
└── lib/
    ├── terrainGeo.ts               # Pure coordinate math (takes TerrainConfig, no constants)
    └── geoGrid.ts                  # Cell ↔ lat/lng helpers, GeoJSON polygon builders
```

---

## 6. Getting Started

**Prerequisites:** Python 3.11+, Node 20+, a model API key.

```bash
# 1. Clone and install
git clone <repo-url> && cd vanguard
cd backend && python -m venv venv && venv/bin/pip install -r requirements.txt
cd ../frontend && npm install

# 2. Configure backend/.env
SUPERVISOR_MODEL=openrouter/x-ai/grok-4.1-fast
WORKER_MODEL=openrouter/x-ai/grok-4.1-fast
OPENROUTER_API_KEY=sk-or-...
# ANTHROPIC_API_KEY=...   # if using anthropic/* models

# 3. Launch everything
cd frontend && npm run start:all
# → MCP server: localhost:8001
# → API server: localhost:8000
# → Dashboard:  localhost:8080
```

**Mock mode (no API calls, validates full pipeline in <30s):**
```bash
cd backend && MOCK_MODE=1 PYTHONPATH=. venv/bin/python test_fast.py
```
