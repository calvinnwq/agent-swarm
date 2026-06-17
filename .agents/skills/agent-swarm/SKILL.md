---
name: agent-swarm
description: Run and inspect Agent Swarm CLI panels from the correct project directory, including expert panels, adversarial reviews, customer panels, presets, docs, harness/model checks, and synthesis summaries.
---

# Agent Swarm

Use this skill when the user asks to run, configure, smoke-test, or summarize an Agent Swarm run.

## Operating Rules

- Run `agent-swarm` from the directory that owns the intended `.agent-swarm/` config.
- Use `.agent-swarm/` for current config, agents, presets, and run artifacts. Treat `.swarm/` as legacy fallback only.
- Prefer focused one-round runs for live demos, smoke tests, and quick decisions.
- Use `--resolve off` when speed matters or when mixed harnesses/models are the thing being demonstrated.
- Use `--quiet` for demo/CI readability.
- Use a generous `--timeout-ms` for live demos. A longer timeout prevents failure; it does not slow the happy path.
- Keep carry-forward docs minimal and explicit. Two docs is usually enough for a live run.
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

## Run Shape

Use this baseline for fast, live-safe panel runs:

```bash
agent-swarm run 1 "<decision question>" \
  --preset <preset-name> \
  --resolve off \
  --doc <path> \
  --doc <path> \
  --timeout-ms 600000 \
  --quiet
```

For built CLI runs from `demo/`:

```bash
node ../dist/cli.mjs run 1 "<decision question>" \
  --preset <preset-name> \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

## Demo Presets

When running the checked-in meetup demo from `demo/`, use these presets:

Expert Panel:

```bash
agent-swarm run 1 "What should be the next 1-day improvement in this repo?" \
  --preset demo-expert-panel \
  --resolve off \
  --doc ../README.md \
  --doc ../SPEC.md \
  --timeout-ms 600000 \
  --quiet
```

Adversarial Review:

```bash
agent-swarm run 1 "Should we implement this feature now, defer it, or reduce scope?" \
  --preset demo-adversarial-review \
  --resolve off \
  --doc ../README.md \
  --doc docs/feature-spec.md \
  --timeout-ms 600000 \
  --quiet
```

Customer Panel:

```bash
agent-swarm run 1 "What would make Agent Swarm worth trying for a technical user in the first 10 minutes?" \
  --preset demo-customer-panel \
  --resolve off \
  --doc ../README.md \
  --doc ../INSTALL.md \
  --timeout-ms 600000 \
  --quiet
```

## Harness/Model Smoke

From `demo/`, two runs cover the checked-in mixed harness/model setup:

```bash
node ../dist/cli.mjs run 1 "Smoke test harness/model routing only. Return minimal valid JSON saying smoke-ok." \
  --preset demo-expert-panel \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

```bash
node ../dist/cli.mjs run 1 "Smoke test harness/model routing only. Return minimal valid JSON saying smoke-ok." \
  --preset demo-adversarial-review \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

Inspect resolved runtimes:

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
- main agreement or disagreement
- practical next step
- risks or caveats
- run directory path
