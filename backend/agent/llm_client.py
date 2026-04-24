"""
llm_client.py — Unified async LLM wrapper with model config switching.

All LLM calls in this system go through a single function: llm_call().
It handles:
  - Model routing via SUPERVISOR_MODEL / WORKER_MODEL env vars
  - Structured output: parses the response into a Pydantic schema
  - Retry logic with exponential backoff (3 attempts)
  - Prompt caching headers for Anthropic models (90% savings on system prompts)
  - Async execution via asyncio.to_thread (LiteLLM's completion() is sync)

Configure models in backend/.env:
    SUPERVISOR_MODEL=openrouter/x-ai/grok-4.1-fast
    WORKER_MODEL=openrouter/x-ai/grok-4.1-fast

Any LiteLLM-compatible model string works. Examples:
    anthropic/claude-sonnet-4-5
    openai/gpt-4.1-mini
    openrouter/x-ai/grok-4.1-fast

Usage:
    from agent.llm_client import llm_call, get_model, ModelRole
    from agent.schemas import SupervisorPlan

    plan: SupervisorPlan = await llm_call(
        role=ModelRole.SUPERVISOR,
        system_prompt=SUPERVISOR_SYSTEM_PROMPT,
        user_prompt=prompt,
        schema=SupervisorPlan,
    )
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from enum import Enum
from typing import Type, TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Token usage tracker
# ---------------------------------------------------------------------------

class TokenTracker:
    """
    Accumulates token usage across all LLM calls in a mission.
    Call reset_token_tracker() at mission start, get_token_summary() at end.
    """

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self._calls: list[dict] = []

    def record(self, role: str, model: str, input_tokens: int, output_tokens: int) -> None:
        self._calls.append({
            "role": role,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        })

    def summary(self) -> dict:
        total_input = sum(c["input_tokens"] for c in self._calls)
        total_output = sum(c["output_tokens"] for c in self._calls)
        by_role: dict[str, dict] = {}
        for c in self._calls:
            r = c["role"]
            if r not in by_role:
                by_role[r] = {"calls": 0, "input_tokens": 0, "output_tokens": 0, "model": c["model"]}
            by_role[r]["calls"] += 1
            by_role[r]["input_tokens"] += c["input_tokens"]
            by_role[r]["output_tokens"] += c["output_tokens"]
        return {
            "total_calls": len(self._calls),
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "by_role": by_role,
        }

    def log_summary(self) -> None:
        s = self.summary()
        logger.info("=" * 60)
        logger.info("TOKEN USAGE SUMMARY")
        logger.info("  Total calls:         %d", s["total_calls"])
        logger.info("  Total input tokens:  %d", s["total_input_tokens"])
        logger.info("  Total output tokens: %d", s["total_output_tokens"])
        for role, data in s["by_role"].items():
            logger.info(
                "  [%s] model=%s | calls=%d | input=%d | output=%d",
                role.upper(), data["model"], data["calls"],
                data["input_tokens"], data["output_tokens"],
            )
        logger.info(
            "  Cost = (input/1M × $/M_in) + (output/1M × $/M_out)"
        )
        logger.info("=" * 60)


# Module-level singleton — one per process, reset per mission
_token_tracker = TokenTracker()


def reset_token_tracker() -> None:
    """Call at the start of each mission to clear totals from previous runs."""
    _token_tracker.reset()


def get_token_summary() -> dict:
    """Return the current accumulated token usage as a dict."""
    return _token_tracker.summary()


# ---------------------------------------------------------------------------
# Model role enum
# ---------------------------------------------------------------------------

class ModelRole(str, Enum):
    SUPERVISOR = "supervisor"   # planning, monitoring, redistribution, summary
    WORKER = "worker"           # individual drone decisions


# ---------------------------------------------------------------------------
# Model selection — read directly from env vars
# ---------------------------------------------------------------------------

_DEFAULT_SUPERVISOR = "openrouter/x-ai/grok-4.1-fast"
_DEFAULT_WORKER     = "openrouter/x-ai/grok-4.1-fast"


def get_model(role: ModelRole) -> str:
    """
    Return the model string for a given role.

    Reads SUPERVISOR_MODEL / WORKER_MODEL from the environment (.env file).
    Falls back to grok-4.1-fast for both roles if not set.
    """
    if role == ModelRole.SUPERVISOR:
        model = os.getenv("SUPERVISOR_MODEL", _DEFAULT_SUPERVISOR)
    else:
        model = os.getenv("WORKER_MODEL", _DEFAULT_WORKER)

    if not model.strip():
        logger.warning(
            "%s env var is empty, falling back to default: %s",
            "SUPERVISOR_MODEL" if role == ModelRole.SUPERVISOR else "WORKER_MODEL",
            _DEFAULT_SUPERVISOR if role == ModelRole.SUPERVISOR else _DEFAULT_WORKER,
        )
        model = _DEFAULT_SUPERVISOR if role == ModelRole.SUPERVISOR else _DEFAULT_WORKER

    return model


def get_active_config() -> dict[str, str]:
    """Return the active {supervisor, worker} model strings."""
    return {
        "supervisor": get_model(ModelRole.SUPERVISOR),
        "worker":     get_model(ModelRole.WORKER),
    }


# ---------------------------------------------------------------------------
# Prompt caching — Anthropic models only
# ---------------------------------------------------------------------------

def _is_anthropic(model: str) -> bool:
    return model.startswith("anthropic/")


def _build_messages(
    system_prompt: str,
    user_prompt: str,
    model: str,
) -> tuple[list[dict], dict]:
    """
    Build the messages list and any extra kwargs for the LiteLLM call.

    For Anthropic models, adds cache_control to the system prompt so
    repeated identical system prompts are cached (~90% cost reduction
    on input tokens for the system message).
    """
    extra_kwargs: dict = {}

    if _is_anthropic(model):
        # LiteLLM passes cache_control through to Anthropic's API
        messages = [
            {
                "role": "system",
                "content": [
                    {
                        "type": "text",
                        "text": system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
            },
            {"role": "user", "content": user_prompt},
        ]
    else:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

    return messages, extra_kwargs


# ---------------------------------------------------------------------------
# Schema type variable
# ---------------------------------------------------------------------------

T = TypeVar("T", bound=BaseModel)


# ---------------------------------------------------------------------------
# Core LLM call with retry
# ---------------------------------------------------------------------------

async def llm_call(
    role: ModelRole,
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
    max_retries: int = 3,
    timeout: float = 30.0,
) -> T:
    """
    Make an async LLM call and parse the response into a Pydantic schema.

    The model is selected from the active config based on `role`.
    Response is expected as JSON matching the schema. On parse failure,
    retries up to max_retries times with exponential backoff.

    Args:
        role:          ModelRole.SUPERVISOR or ModelRole.WORKER
        system_prompt: Agent system prompt (cached for Anthropic models)
        user_prompt:   Per-round user message with current state
        schema:        Pydantic model class to validate response against
        max_retries:   Number of attempts before raising (default 3)
        timeout:       Per-call timeout in seconds (default 30)

    Returns:
        Validated instance of `schema`

    Raises:
        LLMCallError: After all retries exhausted
    """
    # MOCK_MODE — bypass real LLM for fast testing (set MOCK_MODE=1 before importing)
    if os.getenv("MOCK_MODE", "0") == "1":
        return _mock_response(role, system_prompt, user_prompt, schema)

    model = get_model(role)
    messages, extra_kwargs = _build_messages(system_prompt, user_prompt, model)

    # Append structured output instruction to user prompt on retries
    schema_instruction = (
        f"\n\nRespond ONLY with a valid JSON object matching this schema:\n"
        f"{json.dumps(schema.model_json_schema(), indent=2)}\n"
        f"No markdown, no backticks, no preamble. Pure JSON only."
    )

    last_error: Exception | None = None

    for attempt in range(1, max_retries + 1):
        try:
            # Inject schema instruction on first attempt; already present on retries
            call_messages = list(messages)
            if attempt == 1:
                call_messages[-1] = {
                    "role": "user",
                    "content": user_prompt + schema_instruction,
                }
            else:
                # On retry, add a correction nudge
                retry_nudge = (
                    f"\n\nPrevious attempt failed validation: {last_error}\n"
                    f"Try again. Respond ONLY with valid JSON matching the schema above."
                )
                call_messages[-1] = {
                    "role": "user",
                    "content": user_prompt + schema_instruction + retry_nudge,
                }

            logger.debug(
                "LLM call attempt %d/%d | model=%s | role=%s | schema=%s",
                attempt, max_retries, model, role.value, schema.__name__,
            )

            raw_response, input_tokens, output_tokens = await _call_litellm(
                model=model,
                messages=call_messages,
                timeout=timeout,
                extra_kwargs=extra_kwargs,
            )

            parsed = _parse_response(raw_response, schema)

            # Record token usage for this successful call
            _token_tracker.record(
                role=role.value,
                model=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

            logger.debug(
                "LLM call succeeded | model=%s | schema=%s | attempt=%d | in=%d out=%d",
                model, schema.__name__, attempt, input_tokens, output_tokens,
            )
            return parsed

        except Exception as e:
            last_error = e
            if attempt < max_retries:
                backoff = 2 ** (attempt - 1)  # 1s, 2s, 4s
                logger.warning(
                    "LLM call attempt %d failed (%s). Retrying in %ds...",
                    attempt, type(e).__name__, backoff,
                )
                await asyncio.sleep(backoff)
            else:
                logger.error(
                    "LLM call failed after %d attempts | model=%s | schema=%s | error=%s",
                    max_retries, model, schema.__name__, e,
                )

    raise LLMCallError(
        f"LLM call failed after {max_retries} attempts. "
        f"Model: {model}, Schema: {schema.__name__}, Last error: {last_error}"
    )


# ---------------------------------------------------------------------------
# LiteLLM wrapper (sync → async via to_thread)
# ---------------------------------------------------------------------------

async def _call_litellm(
    model: str,
    messages: list[dict],
    timeout: float,
    extra_kwargs: dict,
) -> str:
    """
    Call LiteLLM's sync completion() in a thread pool to avoid blocking
    the asyncio event loop during network I/O.

    Records token usage in the global _token_tracker.
    Returns the raw text content of the first choice.
    """
    import litellm  # deferred import — only needed at call time

    def _sync_call() -> tuple[str, int, int]:
        response = litellm.completion(
            model=model,
            messages=messages,
            timeout=timeout,
            temperature=0.2,
            max_tokens=1024,
            **extra_kwargs,
        )
        text = response.choices[0].message.content or ""
        usage = response.usage or {}
        input_tokens = getattr(usage, "prompt_tokens", 0) or 0
        output_tokens = getattr(usage, "completion_tokens", 0) or 0
        return text, input_tokens, output_tokens

    text, input_tokens, output_tokens = await asyncio.to_thread(_sync_call)
    return text, input_tokens, output_tokens


# ---------------------------------------------------------------------------
# Response parser — strips markdown fences, validates schema
# ---------------------------------------------------------------------------

def _parse_response(raw: str, schema: Type[T]) -> T:
    """
    Strip markdown fences if present, then validate as JSON against schema.
    Raises ValueError with a helpful message on failure.
    """
    cleaned = raw.strip()

    # Strip ```json ... ``` or ``` ... ``` fences
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        # Remove first line (```json or ```) and last line (```)
        inner_lines = lines[1:] if lines[-1].strip() == "```" else lines[1:]
        if inner_lines and inner_lines[-1].strip() == "```":
            inner_lines = inner_lines[:-1]
        cleaned = "\n".join(inner_lines).strip()

    try:
        return schema.model_validate_json(cleaned)
    except Exception as e:
        raise ValueError(
            f"Schema validation failed for {schema.__name__}.\n"
            f"Raw response (first 500 chars): {raw[:500]}\n"
            f"Error: {e}"
        )


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class LLMCallError(Exception):
    """Raised when all retry attempts for an LLM call are exhausted."""
    pass


# ---------------------------------------------------------------------------
# Convenience: log active config at startup
# ---------------------------------------------------------------------------

def log_active_config() -> None:
    config = get_active_config()
    logger.info(
        "LLM config active | supervisor=%s | worker=%s",
        config["supervisor"], config["worker"],
    )


# ---------------------------------------------------------------------------
# MOCK_MODE helpers — deterministic responses for fast testing
# No LLM API calls. Dispatches by schema type, parses structured user_prompts.
# ---------------------------------------------------------------------------

import re as _re
import ast as _ast

def _mock_response(
    role: ModelRole,
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
) -> T:
    """Dispatch to the correct mock based on the expected schema type."""
    from schemas import SupervisorPlan, RedistributionPlan, MissionSummary
    name = schema.__name__
    if name == "SupervisorPlan":
        return _mock_supervisor_plan(user_prompt)  # type: ignore[return-value]
    if name == "RedistributionPlan":
        return _mock_redistribution_plan(user_prompt)  # type: ignore[return-value]
    if name == "MissionSummary":
        return _mock_mission_summary(user_prompt)  # type: ignore[return-value]
    raise ValueError(f"MOCK_MODE: unknown schema '{name}'")


def _mock_supervisor_plan(user_prompt: str) -> "BaseModel":
    from schemas import SupervisorPlan

    if "MISSION START" in user_prompt:
        # Extract scan sector IDs from the plan user prompt
        sids_m = _re.search(r"Scan sector IDs available: (\[[\d,\s]*\])", user_prompt)
        if sids_m:
            all_sids: list = _ast.literal_eval(sids_m.group(1))
        else:
            all_sids = list(range(10))  # fallback if pattern not found
        workers = ["DRONE_A", "DRONE_B", "DRONE_C"]
        sector_assignments: dict[str, list] = {w: [] for w in workers}
        for i, sid in enumerate(all_sids):
            sector_assignments[workers[i % 3]].append(sid)
        return SupervisorPlan(
            reasoning=f"Mock plan: distributing {len(all_sids)} sectors evenly across 3 drones.",
            sector_assignments=sector_assignments, failed_drones=[], phase="plan",
        )

    # Monitor phase — no intervention needed
    return SupervisorPlan(
        reasoning="Mock monitor: all active drones progressing, no intervention required.",
        sector_assignments={}, failed_drones=[], phase="monitor",
    )


def _mock_redistribution_plan(user_prompt: str) -> "BaseModel":
    from schemas import RedistributionPlan

    drone_m = _re.search(r"FAILURE DETECTED - (\S+) is offline", user_prompt)
    failed_drone = drone_m.group(1) if drone_m else "DRONE_C"

    orphan_m = _re.search(r"Orphaned cells \(unscanned\): (\[.*?\])", user_prompt)
    orphaned: list = _ast.literal_eval(orphan_m.group(1)) if orphan_m else []

    # Prefer algorithm recommendation if present
    rec_m = _re.search(
        r"ALGORITHM REDISTRIBUTION RECOMMENDATION.*?:\n(.*?)(?=\nAccept|\Z)",
        user_prompt, _re.DOTALL,
    )
    if rec_m:
        new_assignments: dict[str, list] = {}
        for line in rec_m.group(1).strip().splitlines():
            lm = _re.match(r"\s*(\w+): (\[.*?\])", line)
            if lm:
                cells = _ast.literal_eval(lm.group(2))
                if cells:
                    new_assignments[lm.group(1)] = cells
        if new_assignments:
            return RedistributionPlan(
                reasoning=(
                    f"Mock redistribution: accepting algorithm recommendation"
                    f" for {failed_drone}'s {len(orphaned)} orphaned cells."
                ),
                failed_drone_id=failed_drone, new_assignments=new_assignments,
            )

    # Fallback: round-robin orphaned sectors to surviving drones
    survivors = [d for d in ["DRONE_A", "DRONE_B", "DRONE_C"] if d != failed_drone]
    new_assignments = {s: [] for s in survivors}
    for i, cell in enumerate(orphaned):
        new_assignments[survivors[i % len(survivors)]].append(cell)
    new_assignments = {k: v for k, v in new_assignments.items() if v}
    if not new_assignments:
        new_assignments = {survivors[0]: orphaned or [0]}

    return RedistributionPlan(
        reasoning=(
            f"Mock redistribution: {failed_drone} offline,"
            f" {len(orphaned)} orphaned cells split across {list(new_assignments.keys())}."
        ),
        failed_drone_id=failed_drone, new_assignments=new_assignments,
    )


def _mock_mission_summary(user_prompt: str) -> "BaseModel":
    from schemas import MissionSummary

    rounds_m = _re.search(r"Rounds completed:\s+(\d+)", user_prompt)
    rounds = int(rounds_m.group(1)) if rounds_m else 1

    swept_m = _re.search(r"Sectors swept:\s+(\d+)/(\d+)", user_prompt)
    sectors_swept  = int(swept_m.group(1)) if swept_m else 0
    total_sectors  = int(swept_m.group(2)) if swept_m else 10

    surv_m = _re.search(r"Survivors found:\s+(\d+) at tiles \[(.*?)\]", user_prompt)
    survivors_found = int(surv_m.group(1)) if surv_m else 0
    survivor_str    = surv_m.group(2).strip() if surv_m else ""
    survivor_tile_ids = (
        [s.strip() for s in survivor_str.split(",") if s.strip()]
        if survivor_str else []
    )

    failed_m = _re.search(r"Failed drones:\s+(.+)", user_prompt)
    failed_str   = failed_m.group(1).strip() if failed_m else "none"
    failed_drones = [] if failed_str == "none" else [d.strip() for d in failed_str.split(",")]

    sh_m = _re.search(r"Self-healing:\s+(\w+)", user_prompt)
    self_healing = (sh_m.group(1) == "triggered") if sh_m else bool(failed_drones)

    return MissionSummary(
        reasoning=(
            f"Mock summary: mission ran {rounds} rounds, swept {sectors_swept}/{total_sectors} sectors,"
            f" found {survivors_found} survivors, failures={failed_drones}."
        ),
        rounds_completed=rounds,
        sectors_swept=sectors_swept,
        survivors_found=survivors_found,
        survivor_tile_ids=survivor_tile_ids,
        failed_drones=failed_drones,
        self_healing_triggered=self_healing,
        narrative=(
            f"Mock mission complete in {rounds} rounds."
            f" {sectors_swept}/{total_sectors} sectors swept."
            f" {survivors_found} survivors found."
            f" Self-healing was {'triggered' if self_healing else 'not triggered'}."
        ),
    )
