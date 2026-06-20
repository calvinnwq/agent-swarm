# Dogfood Recipes

These recipes turn Agent Swarm from a runnable CLI into a repeatable decision surface for real operator/OpenClaw work. They use the current alpha contract only: natural prompts, local presets, explicit docs, durable run artifacts, and Decision Brief synthesis.

Use them when the goal is to learn from real decisions before choosing a v0.3 direction. Do not treat these as a saved-run control plane, scheduler, UI, or database design.

## Operator Pattern

Before every recipe:

```bash
cd "$(git rev-parse --show-toplevel)/demo"
node ../dist/cli.mjs doctor
```

Run from the directory that owns the intended `.agent-swarm/` config. Use `--quiet` so the operator can copy the important result back into Discord or Linear without noisy terminal rendering.

After every recipe, inspect:

```bash
latest=$(ls -td .agent-swarm/runs/* | head -1)
cat "$latest/manifest.json"
cat "$latest/synthesis.md"
```

Record the useful friction for M14-04:

- What was easy enough to repeat?
- Which prompt or flag needed operator judgment?
- Which artifact was useful?
- Which output shape was missing?
- What should v0.3 explicitly avoid building?

## Recipe 1: Demo Rehearsal Decision

Use this before a meetup, video, or live demo when the decision is the next one-day improvement.

Human prompt:

```text
Run the expert panel to help answer the question "What should be the next one-day improvement in this repo?"

Please return the synthesis as a Decision Brief with this structure:

Recommendation: <one of the decision options>
Why this wins: <2-3 sentences>
Agent votes:
- <role>: <choice> - <short reason>
Agreement: <what most agents agreed on>
Useful disagreement: <the sharpest tension or tradeoff>
Risks: <top 2 risks if we follow this recommendation>
Smallest next step: <one concrete action we can take in a day>
Demo takeaway: <one sentence I can say out loud to explain why this panel was useful>
```

Command:

```bash
node ../dist/cli.mjs run 1 "What should be the next one-day improvement in this repo?" \
  --preset demo-expert-panel \
  --goal "Help choose the next one-day Agent Swarm demo improvement." \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

Why this preset:

- `demo-expert-panel` gives product, engineering, and design pressure in one round.
- Its default decision is already `Build now / Defer / Reject`, which fits one-day demo decisions.
- No `--doc` is required unless the decision depends on a specific spec or deck file.

Expected synthesis review:

- The recommendation must map to `Build now`, `Defer`, or `Reject`.
- The useful disagreement should expose whether demo clarity, technical risk, or user value is the limiting factor.
- The smallest next step should be small enough to land in one PR.

M14-04 observation target:

- Note whether the Decision Brief is strong enough to make a real project call without manually reading all agent outputs.

## Recipe 2: Linear Project Prioritization

Use this when the operator asks what Agent Swarm project work should happen next and the options span docs, recipes, runtime refactor, or release housekeeping.

Human prompt:

```text
Run the expert panel to help answer the question "Which Agent Swarm Linear issue should we start next?"

Use these options:
- Start NGX-471: dogfood recipes are the best immediate continuation.
- Start NGX-469: docs site should be restored to milestone order.
- Continue M15: the next behavior-preserving runtime boundary slice should begin now.
- Defer project work: demo rehearsal or release housekeeping matters more.

Use docs/release-readiness.md and docs/agent-operation.md as context.

Return a Decision Brief with a recommendation, agent votes, useful disagreement, risks, and the smallest next step.
```

Command:

```bash
node ../dist/cli.mjs run 1 "Which Agent Swarm Linear issue should we start next?" \
  --preset demo-expert-panel \
  --goal "Choose the next Agent Swarm project slice from current roadmap evidence." \
  --decision "Start NGX-471 / Start NGX-469 / Continue M15 / Defer project work" \
  --doc ../docs/release-readiness.md \
  --doc ../docs/agent-operation.md \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

Why this preset:

- Product, engineering, and design roles are enough to compare milestone order, demo value, and implementation risk.
- The explicit `--decision` labels prevent the synthesis from collapsing the choices into generic `Build now / Defer / Reject`.
- The two docs keep the panel grounded in the current roadmap and operator contract.

Expected synthesis review:

- The recommendation must use one of the four labels exactly.
- The disagreement should name the tradeoff between milestone order and demo/dogfood learning.
- The smallest next step should be a concrete Linear issue or PR shape.

M14-04 observation target:

- Note whether passing roadmap docs is enough context, or whether future runs need first-class Linear/project summaries.

## Recipe 3: OpenClaw Workflow Design Review

Use this before changing an OpenClaw agent workflow, skill contract, delivery path, or plugin integration where the main risk is building too much process.

Human prompt:

```text
Run the adversarial review swarm against docs/agent-operation.md to help answer the question "Should we add a reusable OpenClaw workflow around Agent Swarm dogfood runs now, reduce scope, or defer it?"

Use this decision matrix:
- Build now: the workflow is small, repeatable, and reduces operator mistakes immediately.
- Reduce scope: the need is real, but a docs recipe or checklist is enough for now.
- Defer: wait for more dogfood evidence before changing OpenClaw workflow surfaces.
- Reject: this adds process without meaningful leverage.

Return a Decision Brief with the strongest advocate point, strongest skeptic point, top risks, and the smallest safe implementation slice.
```

Command:

```bash
node ../dist/cli.mjs run 1 "Should we add a reusable OpenClaw workflow around Agent Swarm dogfood runs now, reduce scope, or defer it?" \
  --preset demo-adversarial-review \
  --goal "Stress-test whether Agent Swarm dogfood needs an OpenClaw workflow now." \
  --decision "Build now / Reduce scope / Defer / Reject" \
  --doc ../docs/agent-operation.md \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

Why this preset:

- Advocate, skeptic, and implementer roles are better than a friendly expert panel when workflow/process creep is the risk.
- `docs/agent-operation.md` keeps the review tied to current alpha behavior instead of imagined control-plane features.
- The decision matrix keeps `Reduce scope` available, which is often the right answer for agent workflow ideas.

Expected synthesis review:

- The strongest advocate and skeptic points should both be usable in a Linear issue or PR description.
- The smallest safe slice should not require a hosted service, scheduler, SQLite control plane, or new UI.
- If the panel recommends `Build now`, the implementation should still be one small PR.

M14-04 observation target:

- Note whether the friction is operational enough to justify a workflow, or whether better recipe docs solve it.

## What To Feed Into M14-04

After running any recipe, capture a short note with:

```text
Recipe:
Decision:
Run directory:
Useful artifact:
Operator friction:
Missing output shape:
Rejected idea:
Follow-up issue candidate:
```

M14-04 should cite those notes when choosing the v0.3 direction. Strong candidates include goal/decision ergonomics, docs/output sinks, saved spec examples, agent-driven resolution, and OpenClaw child execution. Weak candidates should be named and rejected explicitly.
