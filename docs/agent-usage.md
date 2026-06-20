# Agent Usage

Agents that support local skills can install the public `agent-swarm` skill (see
[Install The Agent Skill](#install-the-agent-skill)) or reference the in-repo copy
at [`../.agents/skills/agent-swarm`](../.agents/skills/agent-swarm). Use that skill
when an operator agent should create, configure, run, inspect, or summarize Agent
Swarm runs from a project.

This guide is the first-run path for agent-operated usage. It is additive to the
CLI contract: it does not add a scheduler, UI, saved-run database, or control
plane.

## Install The Agent Skill

The public adoption path is skill-first: the package ships an installable skill
at `skills/agent-swarm`, so any agent that follows the common skills-installer
convention can add it without a global CLI install.

```bash
npx skills add calvinnwq/agent-swarm --skill agent-swarm
```

This copies the `skills/agent-swarm` directory into the agent's local skills
directory. The flow is agent-agnostic — it does not assume a specific agent
runtime and does not require installing the `agent-swarm` CLI globally.

From a source checkout, copy or reference the same directory directly:

```bash
cp -R skills/agent-swarm /path/to/agent/skills/agent-swarm
```

The repository keeps a byte-identical copy at `.agents/skills/agent-swarm` for
the agents that operate this repo. `skills/agent-swarm` is the public mirror that
ships to consumers; both stay in sync via `pnpm skills:sync`, and a drift check
fails the build if they diverge.

The skill teaches an agent to:

- choose a default or local preset from natural language
- create project-local `.agent-swarm/` agents and presets when asked
- edit `.agent-swarm/config.yml` without hiding CLI precedence
- run the CLI doctor preflight before dispatch
- render repeatable run commands with the packaged helper script
- inspect the latest run artifact with the packaged helper script
- report the recommendation, tradeoff, risks, and run path

The helper lives at
`scripts/agent-swarm-helper.mjs` inside the copied skill directory. Set
`AGENT_SWARM_SKILL_DIR` to the directory containing the copied `SKILL.md` before
using helper examples:

```bash
export AGENT_SWARM_SKILL_DIR=/path/to/agent/skills/agent-swarm
```

In this source checkout, that directory is `skills/agent-swarm` (or the identical
`.agents/skills/agent-swarm`).
The helper handles mechanical command construction and latest-run inspection;
the operator agent still owns the judgment about which project, preset, docs,
question, decision, and report shape to use.

## First-Time Defaults

Run `npx -y @calvinnwq/agent-swarm init` to drop a minimal
`.agent-swarm/config.yml` (`preset: product-triad`, `resolve: off`,
`timeoutMs: 300000`) into the current project. For global/source installs on
`PATH`, use `agent-swarm init`; for source checkouts before
installation/linking, use `node ../dist/cli.mjs init`. It never overwrites an
existing config without `--force`, only ever touches `config.yml`, and CLI flags
still override every value it writes.

Start with a bundled preset unless the project already has a local preset that
matches the request.

| Preset                    | Use When                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- |
| `product-triad`           | Product, design, and build tradeoffs need to be considered together             |
| `adversarial-code-review` | A proposed code change, PR plan, or architecture diff needs review              |
| `customer-panel`          | First-run value, adoption blockers, or outside-in product feedback need testing |

Existing demo presets are intentionally separate. Do not rename or reinterpret
demo presets when creating first-time user defaults.

## Create A New Custom Swarm

When a user asks for a custom swarm, create project-local files under
`.agent-swarm/`:

```text
.agent-swarm/
├── agents/
│   ├── product/<role-a>.yml
│   └── review/<role-b>.yml
├── presets/
│   └── product/<preset-name>.yml
└── config.yml
```

Folders are for readability only. Agent and preset identity still comes from
the YAML `name`, and presets reference those names directly. Prefer small
panels. Presets must reference 2-5 agents.

Example preset:

```yaml
name: project-risk-review
description: Project-local review panel for implementation risk and proof quality.
agents:
  - code-reviewer
  - implementation-skeptic
  - test-risk-reviewer
resolve: orchestrator
goal: Stress-test the proposed change before implementation.
decision: Ready / Revise / Reject
```

Example config:

```yaml
preset: project-risk-review
resolve: off
timeoutMs: 600000
docs:
  - docs/agent-operation.md
```

CLI flags still win over config, and config still wins over preset defaults.

## Run And Report

From the project directory that owns `.agent-swarm/`:

```bash
npx -y @calvinnwq/agent-swarm doctor
node "$AGENT_SWARM_SKILL_DIR/scripts/agent-swarm-helper.mjs" build-run-command \
  --question "<question>" \
  --preset product-triad \
  --decision "Proceed / Defer / Reject" \
  --doc docs/agent-operation.md
```

Run the generated command. For global/source installs on `PATH`, run
`agent-swarm doctor` instead and add `--global-cli` to the helper. For source
checkouts before installation/linking, run `node ../dist/cli.mjs doctor` and add
`--built-cli` to the helper.

Then inspect the newest run:

```bash
node "$AGENT_SWARM_SKILL_DIR/scripts/agent-swarm-helper.mjs" inspect-latest-run \
  --project-dir .
```

Report in the shape requested by the prompt, preset, or agent instructions. If
none is specified, include the recommendation, main tradeoff, material risks,
and run directory path.

## Non-Goals

- No SQLite state.
- No hosted control plane.
- No scheduler.
- No saved-run database.
- No UI.
- No new `agent-swarm templates` command. `agent-swarm init` exists only as a
  tiny helper that writes the minimal `.agent-swarm/config.yml`; it is not a
  wizard and never installs packages, skills, agents, or presets.

Use project-local `.agent-swarm/` files and ordinary `agent-swarm run` commands
until a future runtime feature is deliberately designed and shipped.
