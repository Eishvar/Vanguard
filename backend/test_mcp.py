import asyncio
import sys
import os

# Resolve paths relative to this file's location
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "server"))
sys.path.insert(0, os.path.join(ROOT, "agent"))

from dotenv import load_dotenv
load_dotenv()

from drone_agent import _extract_tool_result
from fastmcp import Client

async def main():
    async with Client("http://localhost:8001/mcp") as mcp:
        # Tool discovery
        tools = await mcp.list_tools()
        print(f"✓ Tools discovered: {[t.name for t in tools]}")

        # Reset mission via MCP tool (initialises the server's GameState)
        result = await mcp.call_tool("reset_mission", {"seed": 42})
        reset_data = _extract_tool_result(result)
        print(f"✓ Mission reset: {reset_data['status']}")

        # Call discover_drones
        result = await mcp.call_tool("discover_drones", {})
        drones = _extract_tool_result(result)
        print(f"✓ discover_drones: {drones}")

        # Call get_grid_state
        result = await mcp.call_tool("get_grid_state", {})
        grid = _extract_tool_result(result)
        print(f"✓ Grid cells: {list(grid['cells'].keys())}")
        print(f"✓ Unscanned: {grid['unscanned']}")

asyncio.run(main())
