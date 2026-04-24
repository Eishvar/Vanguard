# CLAUDE.md — VANGUARD Session Protocol

You are assisting on **VANGUARD**: a multi-agent LLM drone swarm simulation for search-and-rescue. Autonomous drones coordinate, share information, and self-heal when failures occur. The project uses Claude Sonnet 4.6 on high effort and the `andrej-karpathy-skills` plugin philosophy of surgical, minimal edits.

This file is loaded automatically at the start of every Claude Code session.

---

## Session Initialisation Protocol

Before writing any code, read these in order:

1. `docs/arch/OVERVIEW.md` — project structure, grid reference, file tree
2. `docs/arch/LOG.md` — what has been completed so far (always scan latest entries first)
3. `docs/arch/BACKEND.md` — backend architecture
4. `docs/arch/FRONTEND.md` — frontend architecture
5. `docs/arch/EVENTS.md` — SSE event catalogue (authority on backend↔frontend contract)

If the phase prompt specifies a subset, still read `LOG.md` regardless.

---

## GitNexus Rules (critical)

GitNexus is the indexed knowledge graph of the codebase, stored in `.gitnexus/`. Use it before touching existing code.

### Before modifying an existing symbol

```python
gitnexus_context({name: "<symbol_name>"})
gitnexus_impact({target: "<symbol_name>", direction: "upstream"})
```

If `impact` shows **CRITICAL** or **HIGH** risk, report it to the user **before** editing. Proceed only after user confirms, or if the phase prompt explicitly says "this is expected."

### Before every commit / session end

```bash
gitnexus_detect_changes()     # verify only intended files changed
# Session rotation:
/exit
gitnexus clean --force
gitnexus analyze --skip-git
```

**Do NOT use `--embeddings` flag.** This project runs without embeddings (`stats.embeddings: 0`).

### Session rotation between phases

```bash
/exit
gitnexus clean --force
gitnexus analyze --skip-git
claude-a          # or claude-b
<paste next phase prompt>
```

---

## Config-Driven Architecture (non-negotiable)

All geographic and grid constants live in exactly **one** place: `backend/config.py`. Never hardcode them elsewhere.

| Layer | How it gets config |
|---|---|
| Backend Python | `from backend.config import ANCHOR_LAT, GRID_N, ...` |
| Backend prompts/schemas | Interpolate from config into prompt strings or schema defaults |
| SSE contract | Orchestrator emits `terrain_initialized` with `anchor_latlng, grid_n, tile_m, obstacle_elev_threshold` |
| Frontend store | `setTerrainConfig()` action, called by `terrain_initialized` listener |
| Frontend components | Read `terrainConfig` from `useMissionStore()` — never from any constants file |
| Frontend `lib/terrainGeo.ts` | Pure functions that take `TerrainConfig` as argument — NO module-level geographic constants |

**When you modify any file, before committing, run:**
```bash
grep -n "7\\.66\\|110\\.41\\|110\\.39\\|581\\|1100\\b" <file>
```
If anything non-trivial comes back, you've hardcoded a value that should have been imported from config. Fix before committing.

The only "universal" constant that may live at module level anywhere in the frontend is `LAT_PER_M = 1 / 110_574` — it's a property of Earth, not of the mission, and doesn't change when you move the search area.

---

## Multi-Domain Changes Require Doc Updates

When a phase modifies files across multiple layers, also update the relevant doc:

- **New SSE event** → add a row to `docs/arch/EVENTS.md`
- **New file** → add one line to `docs/arch/OVERVIEW.md` file tree
- **New backend class/major function** → brief mention in `docs/arch/BACKEND.md`
- **New frontend component or store field** → brief mention in `docs/arch/FRONTEND.md`

Every phase ends with a `LOG.md` append:

```markdown
## Phase <N> — <Title> — completed YYYY-MM-DD

**New files / Modified files / Deleted files:** (pick whichever apply)
- path/to/file — what changed, in one or two sentences

**Verification:** what test or manual check confirmed the phase worked.
```

---

## `[HUMAN TASK]` Convention

Some steps require manual execution. Tagged `[HUMAN TASK]` in all guides. Ctrl+F to find them.

- When you encounter `[HUMAN TASK]` in a prompt, **stop and inform the user**.
- Do not attempt to perform a `[HUMAN TASK]` yourself.
- After the user confirms completion, continue.

---

## Editing Philosophy (Karpathy)

- **Minimal blast radius.** Touch only files the prompt specifies.
- **Surgical edits.** Add new code over rewriting existing code.
- **No silent deletions.** If a phase requires deleting a file, the prompt says so explicitly.
- **No speculative improvements.** Note unrelated bugs in your summary, don't fix unprompted.
- **Plain code over clever code.** Comments explain *why*, not *what*.

---

## Output Format Per Phase

Every phase prompt follows:

```
TASK: <one sentence>
DOMAIN: <backend|frontend|both|docs>
FILES TO READ: <paths>
SYMBOLS TO CHECK BEFORE CODING: <gitnexus calls>
WHAT TO IMPLEMENT: <detailed spec>
KARPATHY CONSTRAINT: <explicit out-of-scope list>
DONE CRITERIA: <verification steps>
```

Report back at end of session:
1. Which files changed (via `gitnexus_detect_changes()`)
2. Whether each DONE CRITERIA item passed
3. Any warnings, impact-analysis flags, or things the user should review

---

## Project-Specific Conventions

### Coordinate system

- **Math convention, SW-corner origin.**
- `row = 0` is southernmost, `row = 19` is northernmost.
- `col = 0` is westernmost, `col = 19` is easternmost.
- Base station at tile `(row=0, col=0)` — SW corner.
- Local metres: `x = col * TILE_M` (east), `y = row * TILE_M` (north).
- SRTM GeoTIFF uses image convention (row 0 = north). Flip at ingestion only, in `fetch_elevation.py`. Never flip elsewhere.

### Grid

- **20×20 = 400 tiles**, each **100m × 100m**, total 2km × 2km.
- All values read from `config.py`. If you need them, import — never type the number.


### Schemas

- All Pydantic reasoning fields use `min_length=20`.
- Optional list/dict fields use `default_factory=list` or `default_factory=dict`.

### Filesystem

- Codebase lives in **Linux filesystem** (WSL2 Ubuntu). Paths like `/home/<user>/vanguard/...`.
- Never assume `/mnt/c/...`.

---

## When Unsure

- Ask **before** doing any non-trivial thing the prompt didn't cover.
- Prefer stopping and reporting over guessing.
- Precise execution, not improvisation.

---

## Useful one-liners

```bash
# Backend smoke test (runs in Terminal 1)
MOCK_MODE=1 PYTHONPATH=. backend/venv/bin/python backend/test_fast.py

# MCP connectivity (runs in Terminal 1)
PYTHONPATH=. backend/venv/bin/python backend/test_mcp.py

# Frontend build (must be 0 errors before commit)
cd frontend && npm run build

# Config-propagation spot-check: nothing should print
grep -rn "7\\.66\\|110\\.41\\|110\\.39\\|581\\|1100\\b" backend/ --include="*.py" | \
    grep -v config.py | grep -v venv | grep -v __pycache__

grep -rn "7\\.66\\|110\\.41\\|110\\.39\\|581\\|1100\\b" frontend/src/ | \
    grep -v node_modules

# Full local dev (2 Terminal Setup)
# Terminal 1: Claude Code / CLI execution
# Terminal 2: API Engine
cd backend && uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Multi Agent LLM Drone Swarm** (986 symbols, 2455 relationships, 74 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/Multi Agent LLM Drone Swarm/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Multi Agent LLM Drone Swarm/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Multi Agent LLM Drone Swarm/clusters` | All functional areas |
| `gitnexus://repo/Multi Agent LLM Drone Swarm/processes` | All execution flows |
| `gitnexus://repo/Multi Agent LLM Drone Swarm/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
