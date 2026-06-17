# Agent Swarm — Alpha Specification

This is the durable, versioned contract for the **v0.2 alpha** of Agent Swarm.
It captures what the shipped CLI does today so the contract survives independent
of the README's tone and length. The [README](README.md) remains the primary
user-facing entry point; where the two ever disagree about alpha behavior, the
README and current source win and this document should be corrected to match.

Everything documented under **Contract** is shipped and verified. Everything
under **Reserved** is exposed on the surface but adds no behavior yet. Everything
under **Deferred** is not part of the alpha contract at all.

- Package: `@calvinnwq/agent-swarm` (scoped, published to npm)
- Bin: `agent-swarm`
- Storage root: `.agent-swarm/` (legacy `.swarm/` read as fallback)
- Releases: plain `vX.Y.Z` tags and titles; npm publish is manual and not part
  of the automated release workflow.

---

## 1. Identity

Product/storage identity is centralized in `src/lib/identity.ts` and must not be
hardcoded elsewhere.

| Constant            | Value             | Meaning                                       |
| ------------------- | ----------------- | --------------------------------------------- |
| `PRODUCT_NAME`      | `Agent Swarm`     | Human-facing product name                     |
| `CLI_NAME`          | `agent-swarm`     | CLI command/executable bin name               |
| `STORAGE_DIR`       | `.agent-swarm`    | Current storage directory (project and user)  |
| `LEGACY_CLI_NAME`   | `swarm`           | Previous name, retained for migration copy    |
| `LEGACY_STORAGE_DIR`| `.swarm`          | Legacy storage directory, read-only fallback  |

The npm package is scoped (`@calvinnwq/agent-swarm`); the executable bin stays
`agent-swarm`. New writes always target `.agent-swarm/`; legacy `.swarm/` paths
are read-only fallbacks, and the current path always wins when both exist.

---

## 2. Commands

```
Usage: agent-swarm [options] [command]

Commands:
  run [options] <rounds> <topic...>  Run a swarm
  doctor                             Diagnose swarm setup
  help [command]                     Display help for a command
```

`agent-swarm --version` prints the package version. The alpha surface is exactly
two operational commands — `run` and `doctor` — plus Commander's built-in
`help`.

### 2.1 `agent-swarm run <rounds> <topic...>`

| Flag             | Type / values                        | Notes                                                              |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `<rounds>`       | integer 1–3                          | Positional; required.                                              |
| `<topic...>`     | string                               | Positional; required; variadic (joined).                          |
| `--agents`       | comma-separated names                | When set, takes precedence over `--preset` for selection.         |
| `--backend`      | `claude` \| `codex`                  | Run-level backend dial (a `BackendId`).                            |
| `--resolve`      | `off` \| `orchestrator` \| `agents`  | Between-round resolution mode (synonyms below).                    |
| `--goal`         | string                               | Primary goal for the swarm.                                        |
| `--decision`     | string                               | Decision target.                                                   |
| `--doc`          | path (repeatable)                    | Carry-forward document; deduped by path; must be readable.        |
| `--preset`       | name                                 | Used when `--agents` is not provided.                             |
| `--timeout-ms`   | integer ms (default `120000`)        | Per-agent and orchestrator dispatch timeout.                      |
| `--quiet`        | flag                                 | Force quiet output; default auto-selects by TTY.                  |

Constraints (enforced in `parse-command.ts`, errors thrown as
`SwarmCommandError`, exit code `2`):

- `rounds` must be 1–3.
- The resolved agent set must be 2–5 entries.
- Agent names are lowercase with `-`/`_` only.
- `--resolve` accepts the canonical modes plus synonyms:
  - `off` ← `off`, `none`, `no`, `false`, `0`
  - `orchestrator` ← `on`, `yes`, `true`, `1`, `orchestrator`
  - `agents` ← `agent`, `agents`

Carry-forward docs (`--doc`, repeatable) are deduplicated by normalized path and
must be readable files. The first **4,000 characters** of each doc are packed
into the seed brief with provenance, so agents see source content rather than
paths.

**Run exit codes:** a successful run exits `0`; a failed run (including a failed
orchestrator dispatch) finalizes as `failed`, emits a `run:failed` event, and
exits `1`. CLI argument/validation errors exit `2`.

### 2.2 `agent-swarm doctor`

Validates setup before a run and checks:

- `.agent-swarm/config.yml` parses cleanly.
- Configured carry-forward docs exist and are readable (truncation is flagged).
- The agent and preset registries load.
- Agents/preset referenced in project config actually resolve.
- The configured backend is supported and matches config agents that don't pin
  `harness`.
- When a project config is loaded, configured agents' resolved harness CLIs are
  runnable: Claude, Codex, and OpenCode probes verify auth; Codex also verifies
  `codex exec` support; Rovo verifies `acli rovodev`.

Without a project config, doctor skips harness-capability checks. When config is
read from the legacy `.swarm/config.yml` path, doctor reports it explicitly and
points to `.agent-swarm/config.yml`.

**Doctor exit codes:** `0` ready, `1` at least one check failed (with actionable
per-check messages), `2` internal command error.

---

## 3. Configuration precedence

**CLI flags > project config values > preset defaults.** Everything is optional;
with no config file, CLI flags fully describe the run.

### 3.1 Project config (`.agent-swarm/config.yml`)

Validated by `SwarmProjectConfigSchema` (strict object — unknown keys are
errors). Supported keys:

| Key         | Type                          | Notes                                              |
| ----------- | ----------------------------- | -------------------------------------------------- |
| `preset`    | non-empty string              | Named preset.                                      |
| `agents`    | array of 2–5 names            | Alternative to `preset`.                           |
| `backend`   | `claude` \| `codex`           | Run-level backend.                                 |
| `resolve`   | `off` \| `orchestrator` \| `agents` | Between-round mode.                          |
| `timeoutMs` | positive integer              | Mirrors `--timeout-ms` (default `120000`).         |
| `goal`      | non-empty string              | —                                                  |
| `decision`  | non-empty string              | —                                                  |
| `docs`      | array of paths                | Same carry-forward behavior as repeated `--doc`.   |
| `rounds`    | integer 1–3                   | **Reserved** — accepted/validated but not applied. |

A legacy `.swarm/config.yml` is read only when `.agent-swarm/config.yml` is
absent; the current path wins when both exist; doctor flags the legacy path.
Validation errors are reported by doctor and at run start.

---

## 4. Resolution modes (between rounds)

`--resolve` controls behavior **between rounds** while a run is in flight.

| Mode           | Behavior                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`          | Deterministic only. The next-round brief embeds a templated summary built from the prior packet. No extra LLM call. Question resolutions stay empty.             |
| `orchestrator` | Real LLM pass. The bundled `orchestrator` agent reads the prior packet and returns a structured `OrchestratorOutput` (directive, question resolutions, deferred questions, confidence). Each pass is captured for resume. |
| `agents`       | **Reserved.** Accepted and persisted in `manifest.json`/`synthesis.json` but currently behaves like `off`. Kept on the surface so agent-driven resolution can land without a flag rename. |

In `orchestrator` mode the run additionally produces:

- An `orchestrator:pass` event per pass in `events.jsonl` (`agentName`,
  `directive`, `confidence`, `questionResolutionsCount`,
  `questionResolutionLimit`, `deferredQuestionsCount`).
- An `orchestratorPasses` array in `checkpoint.json`, one entry per pass with the
  full `OrchestratorOutput` snapshot.
- The next round's `brief.md` embeds the LLM-derived directive instead of the
  deterministic template.

If an orchestrator dispatch fails (timeout, malformed JSON after the single
repair attempt, non-zero exit), the run finalizes as `failed`, emits
`run:failed`, and exits `1`. Earlier successful passes remain in the checkpoint
so a resume is clean.

---

## 5. Harnesses and backends

`BackendId` and `HarnessId` are deliberately distinct schemas — do not conflate.

- **Backend** (`BackendId`): `claude | codex`. The run-level dial
  (`--backend`/`config.backend`) and run metadata (`wrapperName`).
- **Harness** (`HarnessId`): `claude | codex | opencode | rovo`. The per-agent
  dispatch target.

**Per-agent harness resolution (first wins):** `agent.harness` →
run-level `--backend`/project `backend` → `agent.backend`.

**Per-agent model:** `agent.model` (any non-empty string); omit to let the
harness pick its default. When set, each adapter forwards it to its CLI:
`claude --model`, `codex -m`, `opencode --model`, `acli rovodev run --model`.

When `--resolve orchestrator` is active without a run-level backend override, the
bundled orchestrator inherits the selected agents' harness if every agent
resolves to the same harness; mixed swarms keep the orchestrator on its default.
This enables **mixed-harness swarms** (e.g. one agent on Claude, another on
Codex/OpenCode/Rovo in the same run). At run start the CLI fails fast if any
agent requests an unimplemented harness (`assertResolvedRuntimesAvailable`).

Harness prerequisites:

- **Claude** (default) — `claude` on `PATH`, authenticated (`claude auth login`).
- **Codex** — `codex` on `PATH`, authenticated (`codex login`), new enough for
  `codex exec`.
- **OpenCode** — `opencode` on `PATH`, authenticated (`opencode auth login`).
- **Rovo** — `acli` with the `rovodev` plugin runnable.

The resolved `(harness, model)` pair is captured in `manifest.json` under
`agentRuntimes` and surfaced in each agent's per-round markdown header
(`Harness:` / `Model:`).

---

## 6. Agents and presets

Both registries resolve from three scopes, first match wins, with the current
`.agent-swarm/` root searched before the legacy `.swarm/` root within each
scope. Effective order: project-current → project-legacy → user-current →
user-legacy → bundled. Same-name override across scopes is allowed (current beats
legacy beats bundled); duplicate names inside one root are an error.

| Scope   | Agents                                                       | Presets                            |
| ------- | ------------------------------------------------------------ | ---------------------------------- |
| Project | `.agent-swarm/agents/*.yml` / `*.md`                         | `.agent-swarm/presets/*.yml`       |
| User    | `~/.agent-swarm/agents/*.yml` / `*.md`                       | `~/.agent-swarm/presets/*.yml`     |
| Bundled | ships with `agent-swarm`                                     | ships with `agent-swarm`           |

### 6.1 Bundled agents

`product-manager`, `principal-engineer`, `product-designer`,
`product-manager-codex`, `principal-engineer-codex`, `product-manager-opencode`,
`principal-engineer-opencode`, `orchestrator`.

### 6.2 Bundled presets

| Preset                      | Agents                                                      | Resolve        |
| --------------------------- | ---------------------------------------------------------- | -------------- |
| `product-decision`          | `product-manager`, `principal-engineer`                    | `orchestrator` |
| `product-decision-codex`    | `product-manager-codex`, `principal-engineer-codex`        | `orchestrator` |
| `product-decision-opencode` | `product-manager-opencode`, `principal-engineer-opencode`  | `orchestrator` |
| `triad`                     | `product-manager`, `principal-engineer`, `product-designer`| `orchestrator` |

### 6.3 Agent definition format

YAML or Markdown (frontmatter), validated against the same Zod schema. Fields:
`name`, `description`, `persona`, `prompt` (or the Markdown body), optional
`backend` (`claude` | `codex`), optional `harness`
(`claude`/`codex`/`opencode`/`rovo`), optional `model`. Markdown agents put the
prompt in the body.

### 6.4 Preset format

YAML object with required `name` and `agents` (2–5), plus optional `description`,
`resolve`, `goal`, `decision`. Names are lowercase letters/numbers/`-`/`_`.

### 6.5 Agent output schema

Each agent must return JSON validated by `AgentOutputSchema`:

```json
{
  "agent": "product-manager",
  "round": 1,
  "stance": "Adopt with caveats",
  "recommendation": "Proceed with a phased migration...",
  "reasoning": ["..."],
  "objections": ["..."],
  "risks": ["..."],
  "changesFromPriorRound": [],
  "confidence": "high",
  "openQuestions": ["..."]
}
```

One `MAX_FORMAT_REPAIR_ATTEMPTS` retry is allowed when JSON parse fails.

---

## 7. Run artifacts

Every run produces a self-contained directory under
`.agent-swarm/runs/<timestamp>-<slug>/`:

```
manifest.json          # id, status, topic, goal, decision, rounds, backend, agents, agentRuntimes, timestamps
checkpoint.json        # durable recovery checkpoint after completed rounds
events.jsonl           # append-only orchestration event ledger
messages.jsonl         # append-only staged/committed message ledger
seed-brief.md          # initial brief sent to all agents in round 1
carry-forward-docs/    # optional doc excerpts with provenance (manifest.json + doc-NN.md)
round-NN/
  brief.md             # round brief (round 2+ includes prior packet + orchestrator pass context)
  agents/<name>.md     # per-agent output; header includes Harness:/Model: when runtimes resolved
synthesis.json         # deterministic synthesis output
synthesis.md           # human-readable synthesis report
```

All durable writes are append-only / incremental so a failed run can be
inspected. Three writers fan out from `OutputRouter`: `ArtifactWriter` (round
folders + manifest), `LedgerWriter` (`events.jsonl` + `messages.jsonl`),
`CheckpointWriter` (`checkpoint.json`).

---

## 8. Deterministic synthesis

Synthesis (`buildOrchestratorSynthesis`) is fully deterministic — **no LLM
call**. It aggregates every agent output to produce:

- **Consensus** — unanimous stance across the final round.
- **Stance tally** — count of each unique stance.
- **Top recommendation** — highest confidence, alphabetical tie-break.
- **Shared risks** — risks flagged by ≥2 agents, deduplicated across rounds.
- **Deferred questions** — deduplicated across all rounds, rendered in
  `synthesis.md`.
- **Overall confidence** — rounded average of all agent confidence levels.

---

## 9. Terminal UX

Two modes, auto-selected from `process.stderr.isTTY` unless `--quiet`:

- **Live** (default, TTY) — phase banner, per-agent status rows with elapsed
  timers, flicker-free cell-based diff rendering.
- **Quiet** (`--quiet` or non-TTY) — structured one-line-per-event log for CI.

---

## 10. Reserved and deferred

### 10.1 Reserved (on the surface, no behavior yet)

- `--resolve agents` — accepted and persisted, currently behaves like `off`.
- The `rounds` key in `.agent-swarm/config.yml` — accepted/validated but not
  applied; pass `<rounds>` on the CLI.

### 10.2 Deferred (not part of the alpha contract — v0.3+ candidates)

Tracked under the productionization roadmap (M11–M15); not promised:

- A user-facing `agent-swarm resume` command. Resume is implemented and tested
  internally (`resumeSwarm`) but is **not** exposed as a subcommand.
- Agent-driven `--resolve agents` resolution.
- Richer agent developer experience and dogfood recipes (M14).
- UI / control-plane ideas beyond the current live/quiet renderers.
- A public docs/spec site so the README can stay concise.
- The M15 runtime boundary refactor (behavior-preserving).

---

## 11. Compatibility

- **Legacy `.swarm/` fallback.** Project config, agents, and presets are still
  read from `.swarm/` (and `~/.swarm/`) for at least one release, after their
  `.agent-swarm/` equivalents; the current path wins when both exist. New run
  artifacts are always written under `.agent-swarm/runs/`. Migrate by moving
  `.swarm/` to `.agent-swarm/` when convenient.
- **Python prototype contract.** Agent definitions, output schemas, and artifact
  layout follow the same contracts as the original Python `swarm` prototype, so
  automation consuming run artifacts keeps working.
