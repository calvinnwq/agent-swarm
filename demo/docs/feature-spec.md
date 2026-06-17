# Feature Spec: Reusable Panel Templates

## Problem

Agent Swarm is strongest when users can quickly model a useful panel: expert review, adversarial review, or customer role-play. Today, that setup requires users to understand agent files, preset files, harness selection, model pinning, and prompt shape before they get a good first run.

For a first-time technical user, that is too much setup before the product proves itself.

## Target Users

- Technical founders and builders evaluating Agent Swarm on their own repo.
- Maintainers who want repeatable decision workflows without writing each agent from scratch.
- Agents or assistants that need a predictable local config shape to run a focused swarm.

## Proposed Behavior

Add reusable panel templates for three common patterns:

- `expert-panel`: product, engineering, and UX perspectives.
- `adversarial-review`: advocate, skeptic, and implementer perspectives.
- `customer-panel`: new user, busy operator, and skeptical buyer perspectives.

The template should make it obvious how to create project-local `.agent-swarm/agents/*.yml` and `.agent-swarm/presets/*.yml` files, including mixed harness and model fields.

## Non-Goals

- Do not add a full workflow engine.
- Do not make templates cover every possible agent topology.
- Do not hide the YAML config shape; the demo value is that the config is visible and editable.
- Do not require network calls or model availability during scaffolding.

## Risks

- Premature product surface: template names may harden before real users validate them.
- Maintenance cost: examples can drift from the schema and bundled agents.
- Scope creep: a small scaffold can grow into a large generator too quickly.

## Smallest Safe Slice

Start with documentation and example files only:

- Add a `demo/` folder with project-local panel presets and agents.
- Include copy/paste prompts that run each panel from `demo/`.
- Validate the example files through existing agent and preset registry loading.
- Defer a first-class `agent-swarm init --template ...` command until the examples prove useful.

## Acceptance Criteria

- A user can inspect one folder and understand the agent, preset, prompt, and doc-input shape.
- Each demo panel runs with one round, `resolve: off`, quiet output, and a generous timeout.
- The examples pin harness/model per agent where useful.
- The examples produce a deterministic `synthesis.md` under `demo/.agent-swarm/runs/`.
- Schema validation catches broken demo agents or presets in CI or a focused local check.

