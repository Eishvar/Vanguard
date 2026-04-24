"""
api_server.py — FastAPI application with SSE streaming and mission control.

Three endpoints (from architecture spec):
  POST /api/mission/start          — initialise and launch a mission
  GET  /api/mission/stream         — multiplexed SSE stream of all events
  POST /api/mission/inject-failure — trigger drone failure at next round

The orchestrator runs as a background asyncio task. Events flow from the
orchestrator → asyncio.Queue → SSE generator → frontend EventSource.

Run:
    uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload

CORS is enabled for localhost:3000 (Vite/Next.js frontend dev server).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from contextlib import asynccontextmanager
from typing import Optional

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)                          # backend/ — for "from config import ..."
sys.path.insert(0, os.path.join(ROOT, "server"))
sys.path.insert(0, os.path.join(ROOT, "agent"))

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from orchestrator import Orchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Application state — one active mission at a time
# ---------------------------------------------------------------------------

class MissionState:
    def __init__(self):
        self.orchestrator: Optional[Orchestrator] = None
        self.event_queue: Optional[asyncio.Queue] = None
        self.mission_task: Optional[asyncio.Task] = None
        self.active: bool = False
        self.mission_id: int = 0

mission_state = MissionState()

# ---------------------------------------------------------------------------
# FastAPI app + CORS
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DroneSwarmSAR API starting on port 8000")
    logger.info("MCP server expected at http://localhost:8001/mcp")
    yield
    # Cleanup on shutdown
    if mission_state.mission_task and not mission_state.mission_task.done():
        mission_state.mission_task.cancel()
    logger.info("DroneSwarmSAR API shutdown")

app = FastAPI(
    title="DroneSwarmSAR API",
    description="Multi-agent drone swarm search-and-rescue mission control",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Vite dev server
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://localhost:8080"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class StartMissionRequest(BaseModel):
    pass  # no parameters needed — failure is injected manually via /api/mission/inject-failure

class StartMissionResponse(BaseModel):
    mission_id: int
    status: str
    message: str

class InjectFailureRequest(BaseModel):
    drone_id: str                 # "DRONE_A", "DRONE_B", or "DRONE_C"

class InjectFailureResponse(BaseModel):
    success: bool
    drone_id: str
    message: str

# ---------------------------------------------------------------------------
# POST /api/mission/start
# ---------------------------------------------------------------------------

@app.post("/api/mission/start", response_model=StartMissionResponse)
async def start_mission(request: StartMissionRequest = StartMissionRequest()):
    """
    Initialise and launch a new mission.

    Cancels any currently running mission, creates a fresh orchestrator,
    and starts the mission loop as a background asyncio task. The frontend
    should connect to /api/mission/stream immediately after this call.
    """
    # Cancel any existing mission
    if mission_state.mission_task and not mission_state.mission_task.done():
        logger.info("Cancelling existing mission before starting new one")
        mission_state.mission_task.cancel()
        try:
            await mission_state.mission_task
        except asyncio.CancelledError:
            pass

    # Create fresh state for new mission
    mission_state.mission_id += 1
    mission_state.event_queue = asyncio.Queue(maxsize=200)
    mission_state.orchestrator = Orchestrator()
    mission_state.active = True

    # Launch mission as background task
    async def run_and_cleanup():
        try:
            await mission_state.orchestrator.run_mission(
                event_queue=mission_state.event_queue
            )
        except asyncio.CancelledError:
            logger.info("Mission %d cancelled", mission_state.mission_id)
        except Exception as e:
            logger.error("Mission %d failed: %s", mission_state.mission_id, e)
            # Push error event so the frontend knows
            if mission_state.event_queue:
                await mission_state.event_queue.put({
                    "type": "error",
                    "data": {"message": str(e), "phase": "mission"},
                })
        finally:
            mission_state.active = False
            # Push sentinel to unblock any waiting SSE stream
            if mission_state.event_queue:
                await mission_state.event_queue.put({
                    "type": "stream_end",
                    "data": {"mission_id": mission_state.mission_id},
                })

    mission_state.mission_task = asyncio.create_task(run_and_cleanup())

    logger.info("Mission %d started", mission_state.mission_id)

    return StartMissionResponse(
        mission_id=mission_state.mission_id,
        status="started",
        message=f"Mission {mission_state.mission_id} launched. Connect to /api/mission/stream for events.",
    )

# ---------------------------------------------------------------------------
# GET /api/mission/stream — multiplexed SSE
# ---------------------------------------------------------------------------

@app.get("/api/mission/stream")
async def mission_stream():
    """
    Server-Sent Events stream for the active mission.

    Single multiplexed connection — all event types (drone_cot, grid_update,
    stats_update, supervisor_cot, failure_event, recovery_event,
    mission_complete) are delivered on one EventSource connection using
    named events.

    The stream closes when a stream_end sentinel is received or when the
    client disconnects.

    Connect with:
        const es = new EventSource('http://localhost:8000/api/mission/stream');
        es.addEventListener('drone_cot', (e) => { ... });
        es.addEventListener('grid_update', (e) => { ... });
    """
    if mission_state.event_queue is None:
        raise HTTPException(
            status_code=400,
            detail="No active mission. POST /api/mission/start first.",
        )

    queue = mission_state.event_queue

    async def generate():
        """Drain the event queue and yield SSE-formatted strings."""
        try:
            while True:
                try:
                    # Wait for next event with a timeout so we can send
                    # keepalive pings and detect client disconnects
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    # Keepalive comment — prevents proxy/browser timeout
                    yield ": keepalive\n\n"
                    continue

                event_type = event.get("type", "message")
                event_data = event.get("data", {})

                # Format as SSE with named event
                yield f"event: {event_type}\n"
                yield f"data: {json.dumps(event_data)}\n\n"

                # Sentinel — mission finished, close the stream
                if event_type == "stream_end":
                    break

        except asyncio.CancelledError:
            # Client disconnected
            logger.info("SSE client disconnected")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",       # Disable nginx buffering
            "Connection": "keep-alive",
        },
    )

# ---------------------------------------------------------------------------
# POST /api/mission/inject-failure
# ---------------------------------------------------------------------------

@app.post("/api/mission/inject-failure", response_model=InjectFailureResponse)
async def inject_failure(request: InjectFailureRequest):
    """
    Trigger a drone failure at the start of the next round.

    The orchestrator checks self.pending_failure at the top of each round.
    Setting it here ensures the failure fires cleanly between rounds, not
    mid-execution.

    Valid drone_ids: DRONE_A, DRONE_B, DRONE_C
    """
    valid_drones = {"DRONE_A", "DRONE_B", "DRONE_C"}
    if request.drone_id not in valid_drones:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid drone_id '{request.drone_id}'. Must be one of {valid_drones}",
        )

    if not mission_state.active or mission_state.orchestrator is None:
        raise HTTPException(
            status_code=400,
            detail="No active mission to inject failure into.",
        )

    if request.drone_id in mission_state.orchestrator._offline:
        raise HTTPException(
            status_code=409,
            detail=f"{request.drone_id} is already offline.",
        )

    mission_state.orchestrator.pending_failure = request.drone_id
    logger.info("Failure injection queued for %s", request.drone_id)

    return InjectFailureResponse(
        success=True,
        drone_id=request.drone_id,
        message=f"{request.drone_id} will go offline at the start of the next round.",
    )

# ---------------------------------------------------------------------------
# GET /api/config/terrain — pre-launch terrain config for the frontend
# ---------------------------------------------------------------------------

@app.get("/api/config/terrain")
async def terrain_config():
    """
    Return the terrain grid constants so the frontend can render the
    boundary rectangle, base marker, and search bar before a mission starts.
    """
    from config import ANCHOR_LAT, ANCHOR_LNG, GRID_N, TILE_M, OBSTACLE_ELEV_M
    return {
        "anchor_latlng": [ANCHOR_LAT, ANCHOR_LNG],
        "grid_n": GRID_N,
        "tile_m": TILE_M,
        "obstacle_elev_threshold": OBSTACLE_ELEV_M,
    }

# ---------------------------------------------------------------------------
# GET /api/health — simple liveness check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    """Liveness check. Also returns current mission status."""
    return {
        "status": "ok",
        "mission_active": mission_state.active,
        "mission_id": mission_state.mission_id,
    }

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "api_server:app",
        host="0.0.0.0",
        port=8000,
        reload=False,      # Set True during dev if not using test_run.py
        log_level="info",
    )
