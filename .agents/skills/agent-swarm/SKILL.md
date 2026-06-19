---
name: agent-swarm
description: Create, configure, run, and inspect Agent Swarm panels from the correct project directory.
---

# Agent Swarm

Use this skill when the user asks to create a custom swarm, configure `.agent-swarm/`, manage agents or presets, run a panel, smoke-test setup, inspect artifacts, or summarize an Agent Swarm run. Natural prompts are expected; translate the user's intent into the right config files and CLI invocation instead of asking them for flags.

For the durable operator contract, report shape, artifact expectations, and examples, see `docs/agent-operation.md`. For first-time agent installation and project setup, see `docs/agent-usage.md`. For repeatable operator/OpenClaw dogfood runs, see `docs/dogfood-recipes.md`.

## Operating Rules

- Run `agent-swarm` from the directory that owns the intended `.agent-swarm/` config.
- Use `.agent-swarm/` for current config, agents, presets, and run artifacts. Treat `.swarm/` as legacy fallback only.
- Leave demo presets and demo prompt language alone unless the user explicitly asks to edit the demo.
- Prefer bundled first-time defaults before creating custom files: `product-triad`, `adversarial-code-review`, and `customer-panel`.
- Prefer focused one-round runs for smoke tests, live runs, and quick decisions.
- Use `--resolve off` when speed matters or when the preset already has the right panel shape.
- Use `--quiet` for readable output.
- Use a generous `--timeout-ms` for human-facing runs. A longer timeout prevents failure; it does not slow the happy path.
- Keep carry-forward docs minimal and explicit. Two docs is usually enough when the prompt mentions source material.
- After a run, inspect the newest `.agent-swarm/runs/*/synthesis.md` and summarize the recommendation, tradeoff, risks, and run path.

## Preflight

From the intended project or demo directory:

```bash
agent-swarm doctor
```

If the repo has not linked or installed the package locally, use the built CLI:

```bash
node ../dist/cli.mjs doctor
```

Stop and report exact harness/model failures. Do not rewrite agent files unless the user asks.

## Create Or Configure A Swarm

When the user asks to create a new custom swarm:

1. Use project-local `.agent-swarm/` files.
2. Create only the needed directories: `.agent-swarm/agents/`, `.agent-swarm/presets/`, and optionally `.agent-swarm/config.yml`.
3. Prefer 2-5 named agents with narrow roles.
4. Write presets with `name`, `description`, `agents`, optional `resolve`, `goal`, and `decision`.
5. Use config for project defaults only. Do not hide CLI precedence: CLI flags > config values > preset defaults.
6. Run `agent-swarm doctor` after config changes.

Minimal preset:

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

Minimal config:

```yaml
preset: project-risk-review
resolve: off
timeoutMs: 600000
docs:
  - docs/agent-operation.md
```

## Natural Prompt Workflow

When the user triggers this skill with a human prompt:

1. Identify the intended project directory. Prefer the current directory if it owns `.agent-swarm/`; otherwise use the nearest repo/project named in the prompt.
2. Identify the requested panel or preset. Map common wording to a local preset by name, description, and agents:
   - product triad -> `product-triad` or product manager/product engineer/product designer presets.
   - code review / autoreview / PR review -> `adversarial-code-review` or code-review/risk/test presets.
   - customer panel -> `customer-panel` or customer-role, first-run friction, or trial-blocker presets.
   - expert panel -> product, engineering, and design review presets.
   - adversarial review -> advocate/skeptic/implementer or stress-test presets.
3. Extract the quoted question as the CLI topic. If no quoted question exists, use the clearest question sentence from the prompt.
4. Pass a concise `--goal` derived from the question, for example `Help answer: <question>`.
5. Pass `--decision` when the prompt includes a decision matrix whose labels differ from the selected preset decision. Omit `--decision` only when the prompt has no decision matrix or the matrix already matches the preset default.
6. Add `--doc` only for files explicitly named by the user or obviously required by the preset/task.
7. Run one round by default unless the user asks for more.

Baseline command shape:

```bash
agent-swarm run 1 "<question>" \
  --preset <preset-name> \
  --goal "Help answer: <question>" \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

Add `--doc <path>` for each prompt-named document.

For this repo before installation/linking, use the built CLI from the appropriate project directory:

```bash
node ../dist/cli.mjs run 1 "<question>" \
  --preset <preset-name> \
  --goal "Help answer: <question>" \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

## Harness/Model Smoke

For harness/model smoke, use the fastest local presets that cover the runtimes you need. Keep the prompt tiny and inspect `manifest.json` afterward.

```bash
agent-swarm run 1 "Smoke test harness/model routing only. Return minimal valid JSON saying smoke-ok." \
  --preset <preset-name> \
  --goal "Confirm harness/model routing works." \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

```bash
latest=$(ls -td .agent-swarm/runs/* | head -1)
cat "$latest/manifest.json" | jq '.agentRuntimes'
```

## Summarize The Run

Find the newest run:

```bash
latest=$(ls -td .agent-swarm/runs/* | head -1)
```

Read:

```bash
cat "$latest/synthesis.md"
```

Report:

- recommendation
- tradeoff or disagreement
- requested explanation format
- risks or caveats when relevant
- run directory path
