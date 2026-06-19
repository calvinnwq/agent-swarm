# Agent Usage

Agents that support local skills can copy or reference the repo skill at
[`../.agents/skills/agent-swarm`](../.agents/skills/agent-swarm). Use that skill
when an operator agent should create, configure, run, inspect, or summarize Agent
Swarm runs from a project.

This guide is the first-run path for agent-operated usage. It is additive to the
CLI contract: it does not add a scheduler, UI, saved-run database, or control
plane.

## Install The Agent Skill

From a source checkout, copy or reference the whole skill directory:

```bash
cp -R .agents/skills/agent-swarm /path/to/agent/skills/agent-swarm
```

If the package is installed from npm, the skill is shipped with the package
files so agent installers can copy the same directory from the installed package
root.

The skill teaches an agent to:

- choose a default or local preset from natural language
- create project-local `.agent-swarm/` agents and presets when asked
- edit `.agent-swarm/config.yml` without hiding CLI precedence
- run `agent-swarm doctor` before dispatch
- render repeatable run commands with the packaged helper script
- inspect the latest run artifact with the packaged helper script
- report the recommendation, tradeoff, risks, and run path

The helper lives at
`.agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs`. It handles
mechanical command construction and latest-run inspection; the operator agent
still owns the judgment about which project, preset, docs, question, and
decision to use.

## First-Time Defaults

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
│   ├── <role-a>.yml
│   └── <role-b>.yml
├── presets/
│   └── <preset-name>.yml
└── config.yml
```

Prefer small panels. Presets must reference 2-5 agents.

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
agent-swarm doctor
node .agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs build-run-command \
  --question "<question>" \
  --preset product-triad \
  --decision "Proceed / Defer / Reject" \
  --doc docs/agent-operation.md
```

Run the generated command. For source checkouts before installation/linking, add
`--built-cli`.

Then inspect the newest run:

```bash
node .agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs inspect-latest-run \
  --project-dir .
```

Report:

```text
Recommendation: <winning outcome>
Tradeoff: <main disagreement or cost>
Why: <1-3 sentences grounded in synthesis>
Risks: <material caveats>
Evidence: <run directory path>
```

## Non-Goals

- No SQLite state.
- No hosted control plane.
- No scheduler.
- No saved-run database.
- No UI.
- No new `agent-swarm templates` or `agent-swarm init` command.

Use project-local `.agent-swarm/` files and ordinary `agent-swarm run` commands
until a future runtime feature is deliberately designed and shipped.
