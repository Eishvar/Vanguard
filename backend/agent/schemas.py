"""
schemas.py — Pydantic models for all LLM structured outputs.

Every LLM call produces a response validated against one of these schemas.
The reasoning field is mandatory chain-of-thought on every schema.

Schema inventory:
  SupervisorPlan      — supervisor's planning/assignment decision
  RedistributionPlan  — supervisor's self-healing redistribution decision
  MissionSummary      — final mission report at completion
"""

from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator


# ---------------------------------------------------------------------------
# SupervisorPlan — planning and monitoring
# ---------------------------------------------------------------------------

class SupervisorPlan(BaseModel):
    """
    Structured output from the supervisor agent's planning LLM call.

    Used in two contexts:
      - Phase 'plan': initial sector assignment at mission start.
      - Phase 'monitor': per-round check that drones are on track.
    """

    reasoning: str = Field(
        ...,
        description=(
            "Step-by-step planning logic: drone count → sector distribution → "
            "assignment rationale. For monitor phase: drone statuses → "
            "any anomalies → decision to continue or intervene."
        ),
        min_length=20,
    )
    sector_assignments: dict[str, list[int]] = Field(
        ...,
        description=(
            "Mapping of drone_id to list of terrain sector IDs. "
            "Must cover every non-obstacle sector exactly once. "
            "E.g. {'DRONE_A': [0, 3], 'DRONE_B': [1, 4], 'DRONE_C': [5, 6]}."
        ),
    )
    failed_drones: list[str] = Field(
        default_factory=list,
        description=(
            "List of drone IDs detected as offline this round. "
            "Empty list if all drones are active."
        ),
    )
    phase: Literal["plan", "monitor", "redistribute", "complete"] = Field(
        ...,
        description=(
            "'plan' — initial assignment round. "
            "'monitor' — mid-mission check, no failures. "
            "'redistribute' — failure detected, redistribution needed. "
            "'complete' — all sectors swept, mission over."
        ),
    )


# ---------------------------------------------------------------------------
# RedistributionPlan — self-healing after drone failure
# ---------------------------------------------------------------------------

class RedistributionPlan(BaseModel):
    """
    Structured output from the supervisor's self-healing LLM call.

    Called immediately after a drone failure is detected. The supervisor
    receives the failed drone ID, orphaned sector IDs, surviving drone
    positions and battery levels, and must reassign every orphaned sector.
    """

    reasoning: str = Field(
        ...,
        description=(
            "Nearest-neighbour redistribution logic: failed drone → orphaned sectors → "
            "for each orphaned sector, which surviving drone is closest and has "
            "sufficient battery → final assignment decision."
        ),
        min_length=20,
    )
    failed_drone_id: str = Field(
        ...,
        description="ID of the drone that failed, e.g. 'DRONE_C'.",
    )
    new_assignments: dict[str, list[int]] = Field(
        ...,
        description=(
            "Mapping of surviving drone_id to orphaned SECTOR IDs being reassigned. "
            "Only include drones receiving new sectors. "
            "E.g. {'DRONE_A': [4], 'DRONE_B': [5, 6]}."
        ),
    )

    @model_validator(mode="after")
    def assignments_not_empty(self) -> "RedistributionPlan":
        if not self.new_assignments:
            raise ValueError(
                "new_assignments cannot be empty — all orphaned sectors must be "
                "redistributed to surviving drones."
            )
        return self


# ---------------------------------------------------------------------------
# MissionSummary — final report at mission completion
# ---------------------------------------------------------------------------

class MissionSummary(BaseModel):
    """
    Structured output from the supervisor's final mission summary LLM call.

    Generated once get_mission_state() confirms all sectors are swept.
    Rendered as the mission report in the frontend dashboard and sent as
    the 'mission_complete' SSE event.
    """

    reasoning: str = Field(
        ...,
        description=(
            "Mission debrief: total rounds → coverage achieved → survivors found "
            "→ any failures and how they were resolved → overall assessment."
        ),
        min_length=20,
    )
    rounds_completed: int = Field(
        ...,
        description="Total number of execution rounds run.",
        ge=1,
    )
    sectors_swept: int = Field(
        ...,
        description="Total terrain sectors swept.",
        ge=0,
    )
    survivors_found: int = Field(
        ...,
        description="Number of survivors located.",
        ge=0,
    )
    survivor_tile_ids: list[str] = Field(
        default_factory=list,
        description="Tile IDs where survivors were found, e.g. ['r14_c2', 'r8_c16'].",
    )
    failed_drones: list[str] = Field(
        default_factory=list,
        description="Drone IDs that went offline during the mission.",
    )
    self_healing_triggered: bool = Field(
        default=False,
        description="True if redistribution was performed at least once.",
    )
    narrative: str = Field(
        ...,
        description=(
            "2–4 sentence human-readable mission summary for display in the "
            "frontend dashboard. Written in plain English, past tense."
        ),
        min_length=30,
    )
