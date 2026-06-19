# Agent Operation Contract

Agent Swarm is meant to be operated by another agent from a natural prompt, not only by a human typing CLI flags by hand. This contract defines the repeatable workflow for agent-operated runs without adding a new runtime control plane.

## Purpose

Use this contract when an operator agent needs to:

- choose the right local preset for a decision question
- preserve the user's decision framing while relying on preset defaults
- run `agent-swarm` from the correct project directory
- inspect durable artifacts after the run
- report a concise decision summary with enough proof to trust it

This is guidance for agents and skills. It does not change `agent-swarm run`, add a scheduler, or introduce a hosted service.

For runnable examples that apply this contract to real operator/OpenClaw decisions, see [docs/dogfood-recipes.md](dogfood-recipes.md).

## Non-Goals

- No speculative control-plane implementation.
- No new runtime command or background worker.
- No replacement for `agent-swarm run`; this contract only explains how an operator agent should choose and report a run.

## Inputs

An agent-operated run starts from a human prompt. The prompt should usually include:

- **Panel intent**: expert panel, adversarial review, customer panel, or a named preset.
- **Question**: the decision or evaluation question to ask the swarm.
- **Decision matrix**: allowed outcomes and what each outcome means.
- **Context files**: optional docs/specs/briefs to carry forward.
- **Requested report**: the summary shape the human wants back.

The operator agent should infer CLI details from that prompt. It should not ask the human to provide flags unless the prompt is ambiguous enough that a wrong run would waste time or money.

## Preset Selection

Prefer a named preset when the prompt gives one. Otherwise map common panel language to local presets by name, description, and agent roles:

| Human wording      | Preset shape                                                                            |
| ------------------ | --------------------------------------------------------------------------------------- |
| expert panel       | product, engineering, design, architecture, or domain-expert review                     |
| adversarial review | advocate, skeptic, implementer, risk review, or stress-test panel                       |
| customer panel     | customer-role, new-user, buyer, operator, first-run friction, or trial-conversion panel |

If multiple presets match, prefer the one whose `decision` values best match the prompt's decision matrix. If no preset matches, stop and report the mismatch instead of inventing a panel.

## Command Construction

Default to one round for quick decisions and live use. Use more rounds only when the human asks for deeper debate or when the preset's purpose depends on multiple rounds.

Command rules:

- Run from the directory that owns the intended `.agent-swarm/` config.
- Use the selected preset with `--preset`.
- Use the prompt's question as the topic.
- Pass a short `--goal` derived from the question.
- Pass `--decision` when the prompt includes a decision matrix that differs from the selected preset's default; omit it only when the matrix already matches the preset or the prompt provides no decision matrix.
- Use `--doc` only for files named in the prompt or clearly required by the task.
- Use `--resolve off` when speed matters or when the preset already has the right panel shape.
- Use `--quiet` for readable agent logs.
- Use a generous timeout for real harnesses.

Baseline:

```bash
agent-swarm run 1 "<question>" \
  --preset <preset-name> \
  --goal "Help answer: <question>" \
  --resolve off \
  --timeout-ms 600000 \
  --quiet
```

Add `--doc <path>` for each prompt-named context file. Add `--decision "<label A> / <label B> / ..."` when the prompt-provided decision labels are not already the preset default.

## Artifacts

Every run writes a durable run directory under:

```text
.agent-swarm/runs/<timestamp>-<slug>/
```

The operator should inspect, at minimum:

- `manifest.json` for topic, preset, goal, decision fallback, selected agents, harnesses, and models
- `seed-brief.md` for the packed prompt and carry-forward docs
- `round-*/agents/*.md` for individual agent responses
- `synthesis.json` for deterministic structured synthesis
- `synthesis.md` for the human-readable decision report

For artifact retention, do not copy run outputs elsewhere unless the human asks. The run directory itself is the retained evidence. If a standalone export is created outside the run directory, register or explicitly account for that artifact using the surrounding workspace retention rules.

## Reporting Format

After the run, answer in the format the human requested. If they did not specify a format, use:

```text
Recommendation: <winning outcome>
Tradeoff: <main disagreement or cost>
Why: <1-3 sentences grounded in the synthesis>
Evidence: <run directory path>
Risks: <only material caveats>
```

When the prompt includes a decision matrix, use the matrix labels exactly. Do not invent a new label unless the synthesis cannot be mapped to the provided options; in that case, say so plainly.

## Structured Examples

### Expert panel

Prompt:

```text
$agent-swarm Run the expert panel to help answer the question "What should be the next one-day improvement in this repo?"

Use this decision matrix:
- Build now: small enough to finish today and clearly improves the live demo.
- Defer: valuable, but too risky or too large for the meetup timeline.
- Reject: not compelling enough for this demo.

After the run, review the synthesis and give me:
- the winning recommendation
- the main tradeoff
- a 60-second explanation
```

Operator behavior:

- Select the local expert/product-engineering-design preset.
- Use the quoted question as the topic.
- Pass a goal such as `Help answer: What should be the next one-day improvement in this repo?`.
- Use a preset whose decision default is `Build now / Defer / Reject`, or pass `--decision "Build now / Defer / Reject"` if the best-matching preset uses different labels.
- Report the winning recommendation, tradeoff, and 60-second explanation.

### Adversarial review

Prompt:

```text
$agent-swarm Run the adversarial review against `demo/docs/feature-spec.md` to help answer the question "Should we implement this feature now, defer it, or reduce scope?"

Use this decision matrix:
- Build now: clear demo value, bounded implementation, acceptable failure risk.
- Reduce scope: strong idea, but the safe path is a smaller slice.
- Defer: useful, but not needed for this demo or not ready to implement.
- Reject: weak value, wrong timing, or too much complexity.

After the run, review the synthesis and give me:
- whether the swarm says build now, reduce scope, defer, or reject
- the strongest advocate point
- the strongest skeptic point
- the smallest safe implementation slice
```

Operator behavior:

- Select the local adversarial/stress-test preset.
- Add `--doc demo/docs/feature-spec.md`.
- Pass `--decision "Build now / Reduce scope / Defer / Reject"` unless the selected preset already uses those labels.
- Report both sides of the disagreement before naming the smallest safe implementation slice.

### Customer panel

Prompt:

```text
$agent-swarm Run the customer panel to help answer the question "What would make Agent Swarm worth trying for a technical user in the first 10 minutes?"

Use this decision matrix:
- Fix now: a first-run blocker or clarity gap that directly affects trial success.
- Defer: useful polish, but not critical to a user's first 10 minutes.

After the run, review the synthesis and give me:
- the clearest first-10-minute blocker
- what would make Agent Swarm worth trying faster
- the best 60-second product explanation angle
```

Operator behavior:

- Select the local customer/new-user/buyer preset.
- Use the quoted first-10-minute question as the topic and goal source.
- Pass `--decision "Fix now / Defer"` unless the selected preset already uses those labels, then map the synthesis to `Fix now` or `Defer`.
- Report the blocker, improvement, and product explanation angle.

## Verification Expectations

For changes to this contract or the repo skill that implements it, run:

```bash
pnpm test test/unit/demo-config.test.ts test/unit/docs-contract.test.ts
pnpm format:check
git diff --check
```

For a real agent-operated run, also run `agent-swarm doctor` from the target project before dispatch and inspect the newest run's `manifest.json` plus `synthesis.md` afterward.
