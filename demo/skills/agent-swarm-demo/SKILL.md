---
name: agent-swarm-demo
description: Run the contained Agent Swarm meetup demos from agent-swarm/demo, including expert panel, adversarial review, and customer panel prompts.
---

# Agent Swarm Demo

Use this skill when the user asks to run or prepare the contained Agent Swarm demo panels from the `agent-swarm` repo.

## Rules

- Run commands from `demo/`, because Agent Swarm discovers `.agent-swarm/` from the current working directory.
- Use one round only.
- Use `--resolve off`; do not run an orchestrator pass during the live demo.
- Use `--quiet` for clean terminal output.
- Use `--timeout-ms 600000` for live safety. The long timeout prevents failure; it does not slow the happy path.
- Keep doc inputs to two files when possible.
- After each run, read the newest `.agent-swarm/runs/*/synthesis.md` and summarize the result for a live audience.
- If a harness/model fails locally, report the failing agent and exact command; do not rewrite the demo files unless asked.

## Commands

Expert Panel:

```bash
cd demo
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
cd demo
agent-swarm run 1 "Should we implement this feature now, defer it, or reduce scope?" \
  --preset demo-adversarial-review \
  --resolve off \
  --doc ../README.md \
  --doc docs/feature-spec.md \
  --timeout-ms 600000 \
  --quiet
```

Role-Playing Customer Panel:

```bash
cd demo
agent-swarm run 1 "What would make Agent Swarm worth trying for a technical user in the first 10 minutes?" \
  --preset demo-customer-panel \
  --resolve off \
  --doc ../README.md \
  --doc ../INSTALL.md \
  --timeout-ms 600000 \
  --quiet
```

## After-Run Summary

Find the newest synthesis:

```bash
ls -td .agent-swarm/runs/* | head -1
```

Read that run's `synthesis.md`, then report:

- the recommendation
- the sharpest tradeoff or disagreement
- a 60-second meetup-ready explanation
- the run directory path

