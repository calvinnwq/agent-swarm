---
name: agent-swarm
description: Run and inspect Agent Swarm CLI panels from the correct project directory, including expert panels, adversarial reviews, customer panels, presets, docs, harness/model checks, and synthesis summaries.
---

# Agent Swarm

Use this skill when the user asks to run, configure, smoke-test, or summarize an Agent Swarm run. Natural prompts are expected; translate the user's intent into the right CLI invocation instead of asking them for flags.

For the durable operator contract, report shape, artifact expectations, and examples, see `docs/agent-operation.md`. For repeatable operator/OpenClaw dogfood runs, see `docs/dogfood-recipes.md`.

## Operating Rules

- Run `agent-swarm` from the directory that owns the intended `.agent-swarm/` config.
- Use `.agent-swarm/` for current config, agents, presets, and run artifacts. Treat `.swarm/` as legacy fallback only.
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

## Natural Prompt Workflow

When the user triggers this skill with a human prompt:

1. Identify the intended project directory. Prefer the current directory if it owns `.agent-swarm/`; otherwise use the nearest repo/project named in the prompt.
2. Identify the requested panel or preset. Map common wording to a local preset by name, description, and agents:
   - expert panel -> product, engineering, and design review presets.
   - adversarial review -> advocate/skeptic/implementer or stress-test presets.
   - customer panel -> customer-role, first-run friction, or trial-blocker presets.
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
