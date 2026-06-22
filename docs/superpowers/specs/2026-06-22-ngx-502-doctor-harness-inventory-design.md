# NGX-502 — Doctor harness & agent availability inventory

**Status:** Approved (visual review, 2026-06-22)
**Milestone:** M14 Agent DX and Dogfood Recipes
**Branch:** `calvinnwq/ngx-502-m14-10-add-doctor-harness-and-agent-availability-inventory`

## Problem

`agent-swarm doctor` only probes harnesses when project config exists (`src/lib/doctor.ts`,
the `if (loadedConfig)` guard around the harness loop). A repo with **no config** reports
`ready` while telling the user nothing about Claude / Codex / OpenCode / Rovo availability.
There is also no agent→harness summary, and output is a flat `[OK]/[WARN]/[FAIL]` list with
no sectioning.

## Goals

1. **Always** show a harness availability inventory for all four harnesses, even with no config.
2. Show an agent→harness availability summary mapping configured (or default-preset) agents to
   their resolved harnesses.
3. Keep unavailable harnesses **non-fatal** unless the loaded config actually requires them.
4. Keep **required** harness failures fatal, with `required by: <agent...>` attribution and the
   existing install/auth guidance.
5. Make output sectioned / scannable.

## Approved decisions

- **D1 — Status model:** A missing harness is `WARN` by default. It escalates to `FAIL` **only**
  when this project's own config (selected agents or preset) dispatches an agent to it — i.e. the
  configured run literally cannot execute. With **no config, nothing is required, so no harness
  miss is ever fatal**. "Required" is never global: a single-harness setup passes doctor when its required harness works.
- **D2 — Output:** Add a `section` field to `DoctorCheck`; `formatDoctorReport` prints grouped
  section headers (Configuration, Harness inventory, Agent summary).
- **D3 — No-config agent summary scope:** When there is no config, the agent summary lists the
  **default preset (`product-triad`) agents** (plus the orchestrator, since `product-triad` uses
  `resolve: orchestrator`) — i.e. exactly what `agent-swarm run` would use by default.

## Design

### Harness inventory (always runs)

Replace the config-gated harness loop with one that iterates **all**
`listHarnessDescriptors()`. Before the loop, compute the set of *required* harnesses from
`resolveDoctorHarnesses(config, agentRegistry, presetRegistry)`, which already maps
`harness → attributing agent names`. For each descriptor:

- Run `checkHarnessCapability(harness, { env })` (unchanged probe behavior).
- If probe is `ok` → `OK` in the inventory section.
- If probe is `fail`:
  - **required** (harness is in the required set with ≥1 attributing agent) → keep `FAIL`,
    append `required by: <agents>` to detail (existing behavior preserved).
  - **not required** → downgrade to `WARN`, note it's not used by the current config.

`HarnessCapabilityCheck.status` is only `ok | fail`; the doctor layer performs the
`fail → warn` remap when the harness is optional. The probe module is **not** changed.

### Agent summary section

Surface `resolveDoctorHarnesses` output as a dedicated check in the "Agent summary" section:
each agent and its resolved harness. With config present, use the config's agents/preset. With
no config, resolve the default `product-triad` preset's agents. Failure to resolve the default
preset (e.g. bundled registry missing) is a `warn`, not a hard failure of doctor.

### Sectioned formatter

Add `section?: string` to `DoctorCheck`. `formatDoctorReport` groups checks under their section
header in declaration order, preserving the existing `[OK]/[WARN]/[FAIL]` line format and the
trailing `ready` / `problems found` summary. Sections:

1. **Configuration** — project config, registries, config agents/preset/backend/docs checks.
2. **Harness inventory** — the four harness availability checks.
3. **Agent summary** — agent→harness mapping.

Checks without a section (defensive) fall back to an "Other" group or render ungrouped.

### Overall status

Unchanged: `ok = checks.every(c => c.status !== "fail")`. Optional harness misses are `warn`
so they do not flip the run to failed; required misses remain `fail`.

## Out of scope

- Auto-install / auth repair.
- Model availability validation.
- Scheduler / runtime changes.
- Replacing the existing harness probes.

## Testing

- **Unit (`test/unit/`):**
  - No-config doctor reports the full harness inventory; optional misses are `warn` and doctor
    stays `ok`.
  - Config that selects an agent whose harness is unavailable → `fail` with `required by:` attribution.
  - Mixed-harness config → each harness attributed to the correct agents; available harnesses `ok`,
    unavailable-but-unused harnesses `warn`.
  - Agent summary lists default-preset agents when no config is present.
  - `formatDoctorReport` emits the section headers.
- **E2e (`test/e2e/`):** `agent-swarm doctor` in a bare dir prints the harness inventory section.

## Docs

Update README, SPEC.md, and the docs site (`docs/site/`) doctor reference to describe the
always-on inventory, the optional-vs-required status model, and the agent summary section.
