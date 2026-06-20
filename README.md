# Agent Swarm

Run a panel of AI agents in parallel rounds, then synthesize their answers into a deterministic report.

`agent-swarm` is a TypeScript CLI that fans out 2–5 agents over 1–3 rounds, validates their structured JSON output, and produces a single synthesis you can review or check in.

> **Alpha — v0.2 baseline.** The alpha runtime is feature-complete and ready for dogfooding. This README is the authoritative user-facing contract: anything not documented here — and anything flagged _reserved_ — isn't part of it. For the durable, versioned contract see [SPEC.md](SPEC.md); for a step-by-step setup guide see [INSTALL.md](INSTALL.md); for the runtime internals see [ARCHITECTURE.md](ARCHITECTURE.md). Also see [Status & roadmap](#status--roadmap).

## Install

You'll need:

- Node ≥ 20 (Node 24 LTS recommended — `.nvmrc` pins it; run `nvm use`)
- pnpm 10
- A harness CLI on `PATH`, authenticated. The bundled `product-decision` preset uses Claude (`claude auth login`); other presets use Codex (`codex login`) or OpenCode (`opencode auth login`).

```bash
npm install --global @calvinnwq/agent-swarm
```

This exposes the `agent-swarm` command on your `PATH`.

For source installs:

```bash
pnpm install
pnpm build
pnpm link --global
```

<details>
<summary>First-time <code>pnpm link --global</code> setup</summary>

You'll need pnpm's global bin directory configured once. Run `pnpm setup`, then open a new shell (or `source ~/.zshrc` / `source ~/.bashrc`) before re-running `pnpm link --global`. This is a one-time pnpm setup, not an `agent-swarm`-specific step — see the [pnpm docs](https://pnpm.io/cli/setup).

If you'd rather skip global pnpm config, `npm link` works fine — it uses npm's prefix (typically already on PATH via nvm/Homebrew) against the pnpm-installed dep tree.

</details>

## Quickstart

The supported alpha flow uses the bundled `product-decision` preset, which pairs a `product-manager` and `principal-engineer` agent. No config required.

```bash
# 1. Verify your setup
agent-swarm doctor

# 2. Run a one-round swarm
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision \
  --goal "Decide on migration strategy" \
  --decision "Adopt / Defer / Reject" \
  --timeout-ms 300000
```

When it finishes, you'll find a self-contained run directory under `.agent-swarm/runs/<timestamp>-<slug>/` with a deterministic `synthesis.md`. Real harnesses can take longer than the default 120s timeout — bump `--timeout-ms` for deeper runs. Use `--quiet` for one-line-per-event output (useful in CI).

## How it works

Each `agent-swarm run` follows the same lifecycle:

1. **Plan** — flags, project config, and preset are merged. Each selected agent picks a runtime harness.
2. **Round** — agents run in parallel (concurrency 3 by default) and return JSON validated against the agent output schema.
3. **Between rounds** — depending on `--resolve`, the swarm builds the next directive deterministically or runs an LLM orchestrator pass.
4. **Synthesize** — once the last round finishes, the swarm produces a deterministic synthesis (no LLM call): consensus, top recommendation, shared risks, deferred questions, average confidence.

Everything is durable: events, messages, and a checkpoint are written incrementally so a failed run can be inspected (and, with future tooling, resumed).

## Commands

```
Usage: agent-swarm [options] [command]

Commands:
  run [options] <rounds> <topic...>  Run a swarm
  doctor                             Diagnose swarm setup
  help [command]                     Display help for a command
```

### `agent-swarm run`

```
Usage: agent-swarm run [options] <rounds> <topic...>

Arguments:
  rounds             number of rounds (1–3)
  topic              topic for the swarm

Options:
  --agents <list>    comma-separated agent names
  --backend <name>   runtime backend adapter (claude, codex)
  --resolve <mode>   between-round resolution mode (off | orchestrator | agents)
  --goal <text>      primary goal for the swarm
  --decision <text>  decision target for the swarm
  --doc <path>       carry-forward document (repeatable)
  --preset <name>    named preset (used when --agents is not provided)
  --timeout-ms <ms>  per-agent and orchestrator dispatch timeout (default: 120000)
  --quiet            force quiet output; default auto by TTY
```

Carry-forward docs from `--doc` are deduplicated by path and must be readable files. The first 4,000 characters of each doc are packed into the seed brief with provenance, so agents see source content rather than just paths.

#### Resolution modes

`--resolve` controls what happens **between rounds** while the run is in flight:

| Mode           | Between-round behavior                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`          | Deterministic only — the next-round brief gets a templated summary built from the prior packet. No extra LLM call. Question resolutions stay empty.                                                                                                                                         |
| `orchestrator` | Real LLM pass — the bundled `orchestrator` agent reads the prior packet and returns a structured `OrchestratorOutput` (directive, question resolutions, deferred questions, confidence). The directive feeds the next round, and each pass is captured in `checkpoint.json` for resume use. |
| `agents`       | Reserved — accepted and persisted in `manifest.json`/`synthesis.json` but currently behaves like `off`. Kept on the CLI surface so future agent-driven resolution can land without a flag rename.                                                                                           |

In `orchestrator` mode you also get:

- An `orchestrator:pass` event per pass in `events.jsonl`, with `agentName`, `directive`, `confidence`, `questionResolutionsCount`, `questionResolutionLimit`, and `deferredQuestionsCount`.
- An `orchestratorPasses` array in `checkpoint.json`, one entry per pass with the full `OrchestratorOutput` snapshot for resume.
- The next round's `brief.md` embeds the LLM-derived directive instead of the deterministic template.

If an orchestrator dispatch fails (timeout, malformed JSON after the single repair attempt, non-zero exit), the run finalizes as `failed`, emits a `run:failed` event, and exits `1`. Earlier successful passes stay in the checkpoint so a resume is clean.

```bash
# Two-round run with orchestrator-driven resolution
agent-swarm run 2 "Should we adopt server components?" \
  --preset product-decision \
  --resolve orchestrator \
  --timeout-ms 300000
```

### `agent-swarm doctor`

`agent-swarm doctor` validates your setup before a run. It checks:

- `.agent-swarm/config.yml` parses cleanly.
- Configured carry-forward docs exist and are readable. Truncated docs are flagged.
- The agent and preset registries load.
- Any agents or preset referenced in the project config actually resolve.
- The configured backend is supported and matches config agents that don't pin `harness`.
- When a project config is loaded, configured agents' resolved harness CLIs are runnable. Claude, Codex, and OpenCode probes verify auth; Codex also verifies `codex exec` support; Rovo verifies `acli rovodev`.

Without a project config, doctor skips harness capability checks. When config is read from the legacy `.swarm/config.yml` path, doctor reports it explicitly and points you to `.agent-swarm/config.yml`. Exit codes:

- `0` — everything is ready.
- `1` — at least one check failed (with actionable per-check messages).
- `2` — internal command error.

```bash
agent-swarm doctor
```

## Presets

Agent Swarm ships with seven bundled presets:

| Preset                      | Agents                                                          | Resolve        | Best for                                                                         |
| --------------------------- | --------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| `product-decision`          | `product-manager`, `principal-engineer`                         | `orchestrator` | Framing a product decision through user-value and engineering-feasibility lenses |
| `product-decision-codex`    | `product-manager-codex`, `principal-engineer-codex`             | `orchestrator` | The same flow, dispatched through Codex                                          |
| `product-decision-opencode` | `product-manager-opencode`, `principal-engineer-opencode`       | `orchestrator` | The same flow, dispatched through OpenCode                                       |
| `triad`                     | `product-manager`, `principal-engineer`, `product-designer`     | `orchestrator` | Full product triad: value, feasibility, and UX together                          |
| `product-triad`             | `product-manager`, `product-engineer`, `product-designer`       | `orchestrator` | First-time default for product, design, and build tradeoffs                      |
| `adversarial-code-review`   | `code-reviewer`, `implementation-skeptic`, `test-risk-reviewer` | `orchestrator` | Proposed code changes, PR plans, and architecture diffs                          |
| `customer-panel`            | `first-time-user`, `busy-operator`, `skeptical-buyer`           | `orchestrator` | First-run value, adoption blockers, and outside-in product feedback              |

Invoke by name — no `--agents` required:

```bash
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision \
  --timeout-ms 300000
```

CLI flags still win over preset defaults, so you can override `--resolve`, `--goal`, or `--decision` per run.

### Codex and OpenCode presets

The Codex and OpenCode presets pin agents to their respective harnesses. When `--resolve orchestrator` is active and every selected agent resolves to the same harness, the orchestrator follows along.

- **Claude** (default) — requires `claude` on `PATH` with an existing `claude auth login` session.
- **Codex** — requires `codex` on `PATH`, authenticated with `codex login`, and new enough to support `codex exec`. Use `--backend codex` only when you want to override unpinned agents at the run level.
- **OpenCode** — requires `opencode` on `PATH`, authenticated with `opencode auth login`.

```bash
# Codex
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision-codex \
  --timeout-ms 300000

# OpenCode
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision-opencode \
  --timeout-ms 300000
```

### Custom presets

Presets resolve from three roots, first match wins:

| Source        | Path                                            | Scope          |
| ------------- | ----------------------------------------------- | -------------- |
| Project-local | `.agent-swarm/presets/**/*.yml` / `**/*.yaml`   | This repo      |
| User-global   | `~/.agent-swarm/presets/**/*.yml` / `**/*.yaml` | Your machine   |
| Bundled       | _(ships with agent-swarm)_                      | Always present |

Preset files may be grouped in subdirectories for readability; folder names are organization only, not namespaces. A project-local preset with the same `name` as a bundled preset fully replaces it for that project. A user-global preset overrides bundled machine-wide but yields to project-local. Duplicate `name` values within a single root are an error.

> **Legacy paths.** The previous `.swarm/presets/` (and `~/.swarm/presets/`) locations are still read as a fallback for one release. When both exist, the `.agent-swarm/` path wins. Move your presets to `.agent-swarm/presets/` when convenient.

A preset is a YAML object with required `name` and `agents`, plus optional `description`, `resolve`, `goal`, and `decision`:

```yaml
name: product-decision
description: Product and engineering framing for major product bets
agents:
  - product-manager
  - principal-engineer
resolve: orchestrator
goal: Decide on migration strategy
decision: Adopt / Defer / Reject
```

Preset names use lowercase letters, numbers, `-`, or `_`; `agents` lists 2–5 agent names.

## Project config (`.agent-swarm/config.yml`)

Optional. Set defaults so teammates don't have to remember the flags.

```yaml
preset: product-decision
# or, instead of preset:
# agents: [product-manager, principal-engineer]
backend: claude
goal: Decide on migration strategy
decision: Adopt / Defer / Reject
resolve: off # off | orchestrator | agents
timeoutMs: 300000 # default 120000
docs:
  - docs/architecture.md
```

**Precedence: CLI flags > config values > preset defaults.** Everything is optional — when there's no config file, CLI flags fully describe the run. Validation errors (unknown keys, wrong types) are reported by `agent-swarm doctor` and at run start.

Run `agent-swarm init` to create this file with safe defaults (`preset: product-triad`, `resolve: off`, `timeoutMs: 300000`). It only ever touches `.agent-swarm/config.yml`, never overwrites an existing config without `--force`, and the values it writes are still overridden by CLI flags.

A legacy `.swarm/config.yml` is still read when `.agent-swarm/config.yml` is absent (the `.agent-swarm/` path wins if both exist); `agent-swarm doctor` flags the legacy path so you can migrate.

Configured `docs` use the same carry-forward behavior as repeated `--doc` flags: paths are normalized, readable files are required, and each doc contributes at most 4,000 characters. `timeoutMs` accepts a positive integer and matches `--timeout-ms`.

Supported keys: `preset`, `agents` (2–5 names), `backend`, `resolve`, `timeoutMs`, `goal`, `decision`, `docs`. The `rounds` key is reserved but not yet applied — pass `<rounds>` on the CLI.

## Agents

Agent definitions are YAML or Markdown files resolved from three roots (first wins):

| Path                                                       | Scope                                   |
| ---------------------------------------------------------- | --------------------------------------- |
| `.agent-swarm/agents/**/*.yml` / `**/*.yaml` / `**/*.md`   | Project-local                           |
| `~/.agent-swarm/agents/**/*.yml` / `**/*.yaml` / `**/*.md` | User-global                             |
| _(bundled)_                                                | Ships with agent-swarm; see table below |

Agent files may be grouped in subdirectories for readability; folder names are organization only, not namespaces. A project-local agent with the same `name` as a bundled agent fully replaces it. A user-global agent overrides bundled machine-wide but yields to project-local. Duplicate `name` values within the same root are an error.

> **Legacy paths.** The previous `.swarm/agents/` (and `~/.swarm/agents/`) locations are still read as a fallback for one release, after their `.agent-swarm/` equivalents. When the same agent name exists in both, the `.agent-swarm/` definition wins.

### Bundled agents

| Agent                         | Role                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `product-manager`             | User value, scope, and decision framing                            |
| `principal-engineer`          | System design, feasibility, and operational risk                   |
| `product-engineer`            | Product engineering scope, implementation shape, and delivery risk |
| `product-designer`            | UX, usability, and user-journey perspective                        |
| `code-reviewer`               | Correctness, maintainability, and regression risk                  |
| `implementation-skeptic`      | Scope creep, hidden coupling, and brittle assumptions              |
| `test-risk-reviewer`          | Test coverage, release risk, rollback, and proof quality           |
| `first-time-user`             | Onboarding clarity, setup friction, and early comprehension        |
| `busy-operator`               | Workflow fit, repeated use, and time-to-result pressure            |
| `skeptical-buyer`             | Adoption barriers, value proof, and willingness to keep using it   |
| `product-manager-codex`       | Codex-backed product decision framing                              |
| `principal-engineer-codex`    | Codex-backed engineering feasibility                               |
| `product-manager-opencode`    | OpenCode-backed product decision framing                           |
| `principal-engineer-opencode` | OpenCode-backed engineering feasibility                            |
| `orchestrator`                | Coordinator persona for between-round context and resolve modes    |

### YAML format

```yaml
name: product-manager
description: Strategic product perspective
persona: >
  You are a senior product manager focused on user outcomes,
  market timing, and business viability.
prompt: >
  Evaluate the topic from a product strategy lens. Consider
  user impact, competitive landscape, and delivery risk.
backend: claude # or codex
```

### Markdown format

Markdown agents use YAML frontmatter (validated against the same schema) with the body as the prompt:

```markdown
---
name: principal-engineer
description: Deep technical architecture perspective
persona: >
  You are a principal engineer focused on system design,
  scalability, and long-term maintainability.
backend: claude # or codex
---

Evaluate the topic from a technical architecture lens. Consider
system complexity, operational burden, and migration risk.
```

### Pinning harness and model

Each agent can pin its runtime harness and model independent of the run-level `--backend`:

| Field     | Values                                | Default                                                         |
| --------- | ------------------------------------- | --------------------------------------------------------------- |
| `harness` | `claude`, `codex`, `opencode`, `rovo` | Falls back to the run-level backend, then the agent's `backend` |
| `model`   | Any non-empty string                  | Harness default (the harness chooses)                           |

**Resolution order per agent (first wins):** `agent.harness` → run-level `--backend` or project `backend` → `agent.backend`. When `--resolve orchestrator` is active without a run-level backend override, the bundled orchestrator inherits the selected agents' harness if all agents resolve to the same harness; mixed swarms keep the orchestrator on its default. The resolved `(harness, model)` pair is captured in `manifest.json` under `agentRuntimes` and surfaced in each agent's per-round markdown header (`Harness:` / `Model:`).

This unlocks **mixed-harness swarms**: route one agent through Claude and another through Codex, OpenCode, or Rovo Dev in the same run, as long as each harness's CLI is installed and probes successfully. Claude, Codex, and OpenCode must be authenticated; Rovo requires `acli` with the `rovodev` plugin to be runnable.

```yaml
# .agent-swarm/agents/pm-mixed.yml — Claude with a pinned model
name: pm-mixed
description: Product manager dispatched via Claude
persona: You are a rigorous product manager.
prompt: Evaluate the topic and return the swarm JSON contract.
harness: claude
model: claude-sonnet-4-5
```

```yaml
# .agent-swarm/agents/pe-mixed.yml — Codex, harness-default model
name: pe-mixed
description: Principal engineer dispatched via Codex
persona: You are a principal engineer.
prompt: Evaluate the topic and return the swarm JSON contract.
harness: codex
```

```bash
agent-swarm run 1 "Should we adopt mixed-harness swarms" \
  --agents pm-mixed,pe-mixed \
  --resolve off
```

When `agent.model` is set, every harness adapter forwards it to its CLI: `claude --model`, `codex -m`, `opencode --model`, `acli rovodev run --model`. Omit `agent.model` to let the harness pick a default. At run start, the CLI fails fast if any agent requests an unimplemented harness.

### Agent output schema

Each agent must return JSON of the following shape:

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

## Run artifacts

Every run produces a self-contained directory under `.agent-swarm/runs/`:

```
.agent-swarm/runs/20260419-121439-should-we-adopt-server-components/
├── manifest.json          # Run metadata (id, status, topic, goal, decision, rounds, backend, agents, agentRuntimes, timestamps)
├── checkpoint.json        # Durable recovery checkpoint after completed rounds
├── events.jsonl           # Append-only orchestration event ledger
├── messages.jsonl         # Append-only staged/committed message ledger
├── seed-brief.md          # Initial brief sent to all agents in round 1
├── carry-forward-docs/    # Optional doc excerpts with provenance snapshots
│   ├── manifest.json
│   └── doc-01.md
├── round-01/
│   ├── brief.md
│   └── agents/
│       ├── product-manager.md
│       └── principal-engineer.md
├── round-02/
│   ├── brief.md           # Includes prior-round packet and orchestrator pass context
│   └── agents/...
├── synthesis.json         # Deterministic synthesis output
└── synthesis.md           # Human-readable synthesis report
```

When agent runtimes are resolved, `manifest.json` includes `agentRuntimes` and per-agent markdown files include `Harness:` and `Model:` header fields.

### Synthesis

Synthesis is deterministic — no LLM call. It aggregates every agent output to produce:

- **Consensus** — unanimous stance across the final round
- **Stance tally** — count of each unique stance
- **Top recommendation** — picked by highest confidence with alphabetical tie-break
- **Shared risks** — risks flagged by 2+ agents, deduplicated across rounds
- **Deferred questions** — deduplicated across all rounds, rendered in `synthesis.md`
- **Overall confidence** — rounded average of all agent confidence levels

## Terminal UX

Two rendering modes:

- **Live** (default, TTY) — phase banner, per-agent status rows with elapsed timers, flicker-free cell-based diff rendering.
- **Quiet** (`--quiet` or non-TTY) — structured one-line-per-event log output for CI.

## Status & roadmap

**Supported (the v0.2 alpha contract).** Everything documented above is shipped and verified: `agent-swarm run` and `agent-swarm doctor`, the bundled presets and agents, project config, carry-forward docs, per-agent harness/model pinning (Claude, Codex, OpenCode, Rovo) and mixed-harness swarms, `--resolve off` and `--resolve orchestrator`, durable run artifacts, and deterministic synthesis. This is feature-complete enough to dogfood on real decisions.

**Reserved (accepted, but not part of the contract yet).** These are exposed so a future flag/rename isn't needed, but they don't add behavior today:

- `--resolve agents` — accepted and persisted, but currently behaves like `off`.
- The `rounds` key in `.agent-swarm/config.yml` — reserved but not applied; pass `<rounds>` on the CLI.

**Agent operation.** Agents can operate Agent Swarm from natural prompts by following the repeatable workflow in [docs/agent-operation.md](docs/agent-operation.md). For agent-operated setup — installing the skill into a coding agent and the first run — see [INSTALL.md](INSTALL.md); first-time agent skill installation and project setup also live in [docs/agent-usage.md](docs/agent-usage.md). The npm package ships an installable `skills/agent-swarm` mirror, added with `npx skills add calvinnwq/agent-swarm --skill agent-swarm`. That contract covers preset selection, decision-matrix handling, artifact inspection, and synthesis reporting without adding a new runtime control plane. Runnable dogfood examples for real operator/OpenClaw decisions live in [docs/dogfood-recipes.md](docs/dogfood-recipes.md).

**Future (v0.3+ productionization candidates).** Not promised, not part of the alpha contract — tracked in the project roadmap (M11–M15): a user-facing `agent-swarm resume` command (resume is implemented and tested internally but not yet a subcommand), agent-driven `--resolve agents`, a public docs/spec site so this README can stay concise, CI/release-operations hardening, and deeper agent DX/recipes beyond the current operator contract. Release-readiness status and the full milestone breakdown live in [docs/release-readiness.md](docs/release-readiness.md).

## Migration note

This CLI was previously published as `swarm` and stored data under `.swarm/`. It is now `agent-swarm`, storing project/user data under `.agent-swarm/`. For at least one release, the legacy `.swarm/` locations — project config, agents, presets — are still read as a fallback, with the new `.agent-swarm/` path winning when both exist; new run artifacts are written under `.agent-swarm/runs/`. Migrate by moving `.swarm/` to `.agent-swarm/` when convenient.

It also remains contract-compatible with the Python swarm prototype: agent definitions, output schemas, and artifact layout follow the same contracts, so automation that consumes run artifacts keeps working.

## Contributing & development

Working on `agent-swarm` itself? See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop, the real-harness smoke gate, the release process, and an architecture map; [ARCHITECTURE.md](ARCHITECTURE.md) goes deeper on runtime internals and [SPEC.md](SPEC.md) is the durable runtime contract. Agent-operated run guidance lives in [docs/agent-operation.md](docs/agent-operation.md), with first-time agent setup in [docs/agent-usage.md](docs/agent-usage.md) and dogfood recipes in [docs/dogfood-recipes.md](docs/dogfood-recipes.md). Release/publish operations live in [docs/release-operations.md](docs/release-operations.md), and release history lives in [CHANGELOG.md](CHANGELOG.md).

Community and trust docs: [support](SUPPORT.md), [security](SECURITY.md), [code of conduct](CODE_OF_CONDUCT.md), and [license](LICENSE).
