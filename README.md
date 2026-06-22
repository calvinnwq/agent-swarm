<div align="center">

# Agent Swarm

**Many AI agents on the problem. One answer back.**

[![npm version](https://img.shields.io/npm/v/@calvinnwq/agent-swarm.svg)](https://www.npmjs.com/package/@calvinnwq/agent-swarm) [![npm downloads](https://img.shields.io/npm/dm/@calvinnwq/agent-swarm.svg)](https://www.npmjs.com/package/@calvinnwq/agent-swarm) [![CI](https://github.com/calvinnwq/agent-swarm/actions/workflows/ci.yml/badge.svg)](https://github.com/calvinnwq/agent-swarm/actions/workflows/ci.yml) [![docs](https://img.shields.io/badge/docs-site-blue.svg)](https://calvinnwq.github.io/agent-swarm/) [![license](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE) [![X @calvinnwq](https://img.shields.io/badge/X-%40calvinnwq-black?logo=x)](https://x.com/calvinnwq)

[**Docs**](https://calvinnwq.github.io/agent-swarm/) · [Quickstart](#quickstart) · [Spec](SPEC.md) · [Agent setup](INSTALL.md)

</div>

Ask one model a question and you get one answer, shaped by a single point of
view. Agent Swarm puts several agents on the same question instead - 2 to 5 of
them, each in a different role, all running at once - and merges what they send
back into one report: the recommendation, where they agreed, the risks more than
one of them flagged, and the questions still open. That report is put together by
code rather than another model, so the same answers always produce the same
result.

The bundled presets cover a few common cases, like reviewing a diff or getting
customer-style feedback on a launch, but each one is really just a list of agents
and a set of decision words. Run a preset as it ships, or define your own agents
and wire them into a new one.

## Quickstart

Install the CLI globally - every method ends with the same `agent-swarm` command.
You'll need **Node ≥ 20** (Node 24 LTS recommended) and at least one harness CLI
on your `PATH`, authenticated - the default `product-decision` preset uses Claude
(`claude auth login`).

```bash
# npm
npm install -g @calvinnwq/agent-swarm

# pnpm
pnpm add -g @calvinnwq/agent-swarm

# verify your setup
agent-swarm --version
agent-swarm doctor
```

Then run a one-round swarm - no config required:

```bash
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision \
  --goal "Decide on migration strategy" \
  --decision "Adopt / Defer / Reject" \
  --timeout-ms 300000
```

When it finishes you'll find a self-contained run directory under
`.agent-swarm/runs/<timestamp>-<slug>/` with a deterministic `synthesis.md`.
Real harnesses can take longer than the default 120s timeout - bump
`--timeout-ms` for deeper runs. Use `--quiet` for one-line-per-event output in CI.

<details>
<summary>Run without installing (npx)</summary>

Prefer not to install a global CLI? Run any command through `npx` - swap
`agent-swarm` for `npx -y @calvinnwq/agent-swarm`:

```bash
npx -y @calvinnwq/agent-swarm doctor
npx -y @calvinnwq/agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision \
  --timeout-ms 300000
```

If `npx` can't resolve the scoped-package bin, install globally instead (above).

</details>

<details>
<summary>Install from source</summary>

```bash
pnpm install
pnpm build
pnpm link --global
agent-swarm --version
```

**First-time `pnpm link --global` setup.** You'll need pnpm's global bin
directory configured once. Run `pnpm setup`, then open a new shell (or
`source ~/.zshrc` / `source ~/.bashrc`) before re-running `pnpm link --global`.
This is a one-time pnpm setup, not an `agent-swarm`-specific step - see the
[pnpm docs](https://pnpm.io/cli/setup). If you'd rather skip global pnpm config,
`npm link` works fine - it uses npm's prefix (typically already on PATH via
nvm/Homebrew) against the pnpm-installed dep tree.

</details>

### Recommended agent setup

Agent Swarm is agent-operated, so let your coding agent finish the job. Install
the public skill and the CLI runs on demand via `npx`:

```bash
npx skills add calvinnwq/agent-swarm --skill agent-swarm
```

That installs the public `skills/agent-swarm` mirror into agents that support
local skills; the
skill invokes the CLI on demand with `npx -y @calvinnwq/agent-swarm`, so the
agent path needs no separate install. The skill knows how to pick a preset, handle a decision matrix,
inspect run artifacts, and report the synthesis - see [INSTALL.md](INSTALL.md)
for the full agent-operated setup and first run, and the
[Agent usage guide](https://calvinnwq.github.io/agent-swarm/agent-usage.html) for
the operator workflow.

## How it works

Each `agent-swarm run` follows the same lifecycle:

| Step | What happens |
| --- | --- |
| **1. Plan** | CLI flags, project config, and the chosen preset merge into a run. Each selected agent resolves to a harness (Claude, Codex, OpenCode, or Rovo). |
| **2. Round** | Agents run in parallel (concurrency 3 by default) and each returns JSON validated against the agent output schema. One repair retry on a parse miss. |
| **3. Resolve** | Between rounds, `--resolve` decides the next directive: a deterministic template (`off`) or a real LLM orchestrator pass (`orchestrator`). |
| **4. Synthesize** | After the final round, a deterministic synthesis (no LLM call) computes consensus, the top recommendation, shared risks, and deferred questions. |

Everything is durable: events, messages, and a checkpoint are written
incrementally, so a failed run can be inspected (and, with future tooling,
resumed).

## Presets

Agent Swarm ships seven bundled presets, each with its own set of agents and
decision words. Run one by name (no `--agents` required), or copy it as the
starting point for your own:

| Preset                      | Agents                                                          | Resolve        | Best for                                                                         |
| --------------------------- | --------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------- |
| `product-decision`          | `product-manager`, `principal-engineer`                         | `orchestrator` | Framing a product decision through user-value and engineering-feasibility lenses |
| `product-decision-codex`    | `product-manager-codex`, `principal-engineer-codex`             | `orchestrator` | The same flow, dispatched through Codex                                          |
| `product-decision-opencode` | `product-manager-opencode`, `principal-engineer-opencode`       | `orchestrator` | The same flow, dispatched through OpenCode                                       |
| `triad`                     | `product-manager`, `principal-engineer`, `product-designer`     | `orchestrator` | Full product triad: value, feasibility, and UX together                          |
| `product-triad`             | `product-manager`, `product-engineer`, `product-designer`       | `orchestrator` | First-time default for product, design, and build tradeoffs                      |
| `adversarial-code-review`   | `code-reviewer`, `implementation-skeptic`, `test-risk-reviewer` | `orchestrator` | Proposed code changes, PR plans, and architecture diffs                          |
| `customer-panel`            | `first-time-user`, `busy-operator`, `skeptical-buyer`           | `orchestrator` | First-run value, adoption blockers, and outside-in product feedback              |

```bash
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision \
  --timeout-ms 300000
```

CLI flags still win over preset defaults, so you can override `--resolve`,
`--goal`, or `--decision` per run. Codex/OpenCode presets and custom presets are
covered in the [Reference](#reference).

## Reference

<details>
<summary>Commands &amp; flags</summary>

```
Usage: agent-swarm [options] [command]

Commands:
  run [options] <rounds> <topic...>  Run a swarm
  doctor                             Diagnose swarm setup
  init [options]                     Create .agent-swarm/config.yml defaults
  help [command]                     Display help for a command
```

Running `agent-swarm` with no arguments prints this top-level help and exits 0,
the same as `agent-swarm --help`.

#### `agent-swarm run`

```
Usage: agent-swarm run [options] <rounds> <topic...>

Arguments:
  rounds             number of rounds (1-3)
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

Carry-forward docs from `--doc` are deduplicated by path and must be readable
files. The first 4,000 characters of each doc are packed into the seed brief
with provenance, so agents see source content rather than just paths.

</details>

<details>
<summary>Resolution modes (between rounds)</summary>

`--resolve` controls what happens **between rounds** while the run is in flight:

| Mode           | Between-round behavior                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`          | Deterministic only - the next-round brief gets a templated summary built from the prior packet. No extra LLM call. Question resolutions stay empty.                                                                                                                                         |
| `orchestrator` | Real LLM pass - the bundled `orchestrator` agent reads the prior packet and returns a structured `OrchestratorOutput` (directive, question resolutions, deferred questions, confidence). The directive feeds the next round, and each pass is captured in `checkpoint.json` for resume use. |
| `agents`       | Reserved - accepted and persisted in `manifest.json`/`synthesis.json` but currently behaves like `off`. Kept on the CLI surface so future agent-driven resolution can land without a flag rename.                                                                                           |

In `orchestrator` mode you also get:

- An `orchestrator:pass` event per pass in `events.jsonl`, with `agentName`, `directive`, `confidence`, `questionResolutionsCount`, `questionResolutionLimit`, and `deferredQuestionsCount`.
- An `orchestratorPasses` array in `checkpoint.json`, one entry per pass with the full `OrchestratorOutput` snapshot for resume.
- The next round's `brief.md` embeds the LLM-derived directive instead of the deterministic template.

If an orchestrator dispatch fails (timeout, malformed JSON after the single
repair attempt, non-zero exit), the run finalizes as `failed`, emits a
`run:failed` event, and exits `1`. Earlier successful passes stay in the
checkpoint so a resume is clean.

```bash
# Two-round run with orchestrator-driven resolution
agent-swarm run 2 "Should we adopt server components?" \
  --preset product-decision \
  --resolve orchestrator \
  --timeout-ms 300000
```

</details>

<details>
<summary><code>agent-swarm doctor</code></summary>

`agent-swarm doctor` validates your setup before a run. Output is grouped into
three sections:

- **Configuration** - `.agent-swarm/config.yml` parses cleanly; configured carry-forward docs exist and are readable (truncated docs are flagged); the agent and preset registries load; any agents or preset referenced in the project config resolve; the configured backend is supported.
- **Harness inventory** - all four harnesses (Claude, Codex, OpenCode, Rovo) are probed for availability and auth, even when there is no project config. A harness that is missing or unauthenticated but not required by your configured agents is reported as **WARN** (non-fatal). If a failing harness is required by one or more configured agents it is reported as **FAIL** with `required by: <agent...>` attribution and install/auth guidance. agent-swarm does not globally require any harness - a single-harness setup passes doctor when its required harness works.
- **Agent summary** - each configured agent is mapped to its resolved harness. When there is no project config, the default `product-triad` preset's agents are shown.

When config is read from the legacy `.swarm/config.yml` path, doctor reports it
explicitly and points you to `.agent-swarm/config.yml`. Exit codes:

- `0` - everything is ready.
- `1` - at least one check failed (with actionable per-check messages).
- `2` - internal command error.

```bash
agent-swarm doctor
```

</details>

<details>
<summary>Presets - Codex/OpenCode &amp; custom</summary>

#### Codex and OpenCode presets

The Codex and OpenCode presets pin agents to their respective harnesses. When
`--resolve orchestrator` is active and every selected agent resolves to the same
harness, the orchestrator follows along.

- **Claude** (default) - requires `claude` on `PATH` with an existing `claude auth login` session.
- **Codex** - requires `codex` on `PATH`, authenticated with `codex login`, and new enough to support `codex exec`. Use `--backend codex` only when you want to override unpinned agents at the run level.
- **OpenCode** - requires `opencode` on `PATH`, authenticated with `opencode auth login`.

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

#### Custom presets

Presets resolve from three roots, first match wins:

| Source        | Path                                            | Scope          |
| ------------- | ----------------------------------------------- | -------------- |
| Project-local | `.agent-swarm/presets/**/*.yml` / `**/*.yaml`   | This repo      |
| User-global   | `~/.agent-swarm/presets/**/*.yml` / `**/*.yaml` | Your machine   |
| Bundled       | _(ships with agent-swarm)_                      | Always present |

Preset files may be grouped in subdirectories for readability; folder names are
organization only, not namespaces. A project-local preset with the same `name`
as a bundled preset fully replaces it for that project. A user-global preset
overrides bundled machine-wide but yields to project-local. Duplicate `name`
values within a single root are an error.

> **Legacy paths.** The previous `.swarm/presets/` (and `~/.swarm/presets/`) locations are still read as a fallback for one release. When both exist, the `.agent-swarm/` path wins. Move your presets to `.agent-swarm/presets/` when convenient.

A preset is a YAML object with required `name` and `agents`, plus optional
`description`, `resolve`, `goal`, and `decision`:

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

Preset names use lowercase letters, numbers, `-`, or `_`; `agents` lists 2-5
agent names.

</details>

<details>
<summary>Project config (<code>.agent-swarm/config.yml</code>)</summary>

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

**Precedence: CLI flags > config values > preset defaults.** Everything is
optional - when there's no config file, CLI flags fully describe the run.
Validation errors (unknown keys, wrong types) are reported by `agent-swarm
doctor` and at run start.

Run `agent-swarm init` to create this file with safe defaults (`preset:
product-triad`, `resolve: off`, `timeoutMs: 300000`). It only ever touches
`.agent-swarm/config.yml`, never overwrites an existing config without `--force`,
and the values it writes are still overridden by CLI flags.

A legacy `.swarm/config.yml` is still read when `.agent-swarm/config.yml` is
absent (the `.agent-swarm/` path wins if both exist); `agent-swarm doctor` flags
the legacy path so you can migrate.

Configured `docs` use the same carry-forward behavior as repeated `--doc` flags:
paths are normalized, readable files are required, and each doc contributes at
most 4,000 characters. `timeoutMs` accepts a positive integer and matches
`--timeout-ms`.

Supported keys: `preset`, `agents` (2-5 names), `backend`, `resolve`,
`timeoutMs`, `goal`, `decision`, `docs`. The `rounds` key is reserved but not yet
applied - pass `<rounds>` on the CLI.

</details>

<details>
<summary>Agents - bundled, formats, pinning &amp; output schema</summary>

Agent definitions are YAML or Markdown files resolved from three roots (first
wins):

| Path                                                       | Scope                                   |
| ---------------------------------------------------------- | --------------------------------------- |
| `.agent-swarm/agents/**/*.yml` / `**/*.yaml` / `**/*.md`   | Project-local                           |
| `~/.agent-swarm/agents/**/*.yml` / `**/*.yaml` / `**/*.md` | User-global                             |
| _(bundled)_                                                | Ships with agent-swarm; see table below |

Agent files may be grouped in subdirectories for readability; folder names are
organization only, not namespaces. A project-local agent with the same `name` as
a bundled agent fully replaces it. A user-global agent overrides bundled
machine-wide but yields to project-local. Duplicate `name` values within the
same root are an error.

> **Legacy paths.** The previous `.swarm/agents/` (and `~/.swarm/agents/`) locations are still read as a fallback for one release, after their `.agent-swarm/` equivalents. When the same agent name exists in both, the `.agent-swarm/` definition wins.

#### Bundled agents

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

#### YAML format

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

#### Markdown format

Markdown agents use YAML frontmatter (validated against the same schema) with the
body as the prompt:

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

#### Pinning harness and model

Each agent can pin its runtime harness and model independent of the run-level
`--backend`:

| Field     | Values                                | Default                                                         |
| --------- | ------------------------------------- | --------------------------------------------------------------- |
| `harness` | `claude`, `codex`, `opencode`, `rovo` | Falls back to the run-level backend, then the agent's `backend` |
| `model`   | Any non-empty string                  | Harness default (the harness chooses)                           |

**Resolution order per agent (first wins):** `agent.harness` → run-level
`--backend` or project `backend` → `agent.backend`. When `--resolve orchestrator`
is active without a run-level backend override, the bundled orchestrator inherits
the selected agents' harness if all agents resolve to the same harness; mixed
swarms keep the orchestrator on its default. The resolved `(harness, model)` pair
is captured in `manifest.json` under `agentRuntimes` and surfaced in each agent's
per-round markdown header (`Harness:` / `Model:`).

This unlocks **mixed-harness swarms**: route one agent through Claude and another
through Codex, OpenCode, or Rovo Dev in the same run, as long as each harness's
CLI is installed and probes successfully. Claude, Codex, and OpenCode must be
authenticated; Rovo requires `acli` with the `rovodev` plugin to be runnable.

```yaml
# .agent-swarm/agents/pm-mixed.yml - Claude with a pinned model
name: pm-mixed
description: Product manager dispatched via Claude
persona: You are a rigorous product manager.
prompt: Evaluate the topic and return the swarm JSON contract.
harness: claude
model: claude-sonnet-4-5
```

```yaml
# .agent-swarm/agents/pe-mixed.yml - Codex, harness-default model
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

When `agent.model` is set, every harness adapter forwards it to its CLI: `claude
--model`, `codex -m`, `opencode --model`, `acli rovodev run --model`. Omit
`agent.model` to let the harness pick a default. At run start, the CLI fails fast
if any agent requests an unimplemented harness.

#### Agent output schema

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

</details>

<details>
<summary>Run artifacts &amp; synthesis</summary>

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

When agent runtimes are resolved, `manifest.json` includes `agentRuntimes` and
per-agent markdown files include `Harness:` and `Model:` header fields.

**Synthesis** is deterministic - no LLM call. It aggregates every agent output to
produce:

- **Consensus** - unanimous stance across the final round
- **Stance tally** - count of each unique stance
- **Top recommendation** - picked by highest confidence with alphabetical tie-break
- **Shared risks** - risks flagged by 2+ agents, deduplicated across rounds
- **Deferred questions** - deduplicated across all rounds, rendered in `synthesis.md`
- **Overall confidence** - rounded average of all agent confidence levels

</details>

<details>
<summary>Terminal UX</summary>

Two rendering modes:

- **Live** (default, TTY) - phase banner, per-agent status rows with elapsed timers, flicker-free cell-based diff rendering.
- **Quiet** (`--quiet` or non-TTY) - structured one-line-per-event log output for CI.

</details>

<details>
<summary>Migration from <code>.swarm</code></summary>

This CLI was previously published as `swarm` and stored data under `.swarm/`. It
is now `agent-swarm`, storing project/user data under `.agent-swarm/`. For at
least one release, the legacy `.swarm/` locations - project config, agents,
presets - are still read as a fallback, with the new `.agent-swarm/` path winning
when both exist; new run artifacts are written under `.agent-swarm/runs/`.
Migrate by moving `.swarm/` to `.agent-swarm/` when convenient.

It also remains contract-compatible with the Python swarm prototype: agent
definitions, output schemas, and artifact layout follow the same contracts, so
automation that consumes run artifacts keeps working.

</details>

## Contributing

Working on `agent-swarm` itself? See [CONTRIBUTING.md](CONTRIBUTING.md) for the
dev loop, the real-harness smoke gate, the release process, and an architecture
map. [ARCHITECTURE.md](ARCHITECTURE.md) goes deeper on runtime internals and
[SPEC.md](SPEC.md) is the durable runtime contract. The browsable docs site lives
in [docs/](docs/) and is published at
<https://calvinnwq.github.io/agent-swarm/>. Release history lives in
[CHANGELOG.md](CHANGELOG.md).

## Support and security

Use [GitHub issues](https://github.com/calvinnwq/agent-swarm/issues) for bugs and
feature ideas. See [SUPPORT.md](SUPPORT.md), [SECURITY.md](SECURITY.md), and the
[code of conduct](CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](LICENSE).
