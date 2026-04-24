import asyncio
import sys
import os

# Resolve paths relative to this file's location
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)                          # backend/ — for "from config import ..."
sys.path.insert(0, os.path.join(ROOT, "server"))
sys.path.insert(0, os.path.join(ROOT, "agent"))

from dotenv import load_dotenv
load_dotenv()

from orchestrator import Orchestrator

async def main():
    queue = asyncio.Queue()
    orch = Orchestrator(failure_round=3)

    async def drain_events():
        while True:
            event = await queue.get()
            etype = event["type"]
            data = event["data"]

            if etype == "supervisor_cot":
                print(f"\n[SUPERVISOR] {data['phase'].upper()}")
                print(f"  {data['reasoning']}")
            elif etype == "drone_cot":
                print(f"\n[{data['drone_id']}] Round {data['round']} → {data['action'].upper()}", end="")
                if data.get('target_cell_id'):
                    print(f" to {data['target_cell_id']}", end="")
                print(f" | {data['status']}")
                print(f"  {data['reasoning']}")
            elif etype == "grid_update":
                scanned = data['explored_count']
                total = data['total_cells']
                positions = data['drone_positions']
                print(f"\n[GRID] Coverage: {scanned}/{total} | Positions: {positions}")
            elif etype == "failure_event":
                print(f"\n⚠️  [FAILURE] {data['drone_id']} offline! Orphaned: {data['orphaned_cells']}")
            elif etype == "recovery_event":
                print(f"\n✅ [RECOVERY] New assignments: {data['new_assignments']}")
                print(f"  {data['reasoning']}")
            elif etype == "mission_complete":
                print(f"\n🎯 [COMPLETE] {data['narrative']}")
                print(f"   Rounds: {data['rounds_completed']} | Survivors: {data['survivors_found']} at {data['survivor_locations']}")
                return
            elif etype == "phase_change":
                print(f"\n--- Phase: {data['phase'].upper()} ---")
            elif etype == "error":
                print(f"\n❌ [ERROR] {data}")

    mission_task = asyncio.create_task(orch.run_mission(event_queue=queue))
    drain_task = asyncio.create_task(drain_events())

    await mission_task
    await drain_task

asyncio.run(main())
