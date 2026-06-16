# Swarm CLI — Release Readiness Report

**Version:** 0.2.0 (released as `swarm-v0.2.0`)  
**Date:** 2026-06-16  
**Decision:** ✅ ALPHA BASELINE SHIPPED — every M9 (Release Readiness Gauntlet) and M10 (Orchestrator Resolution Runtime) gate is complete. The alpha is ready for dogfood; remaining work is productionization, tracked under M11–M15 (see [Productionization path](#productionization-path-m11m15)).

> **History note:** An earlier revision of this report (v0.1.0, 2026-04-28) marked the real-harness gates (NGX-144–NGX-147, NGX-151) as ❌ BLOCKED because the autonomous environment had no harness credentials or installs. Those gates were subsequently completed once credentials/installs were available, and all M9/M10 Linear issues are now Done. That earlier "blocked" status is recorded here only as history — it is **not** current truth.

---

## Go / No-Go Table

| #     | Gate                                                  | Status  | Evidence / Notes                                                                                         |
| ----- | ----------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| M9-01 | Codex JSON schema strict validation                   | ✅ PASS | [see below](#m9-01-codex-json-schema)                                                                    |
| M9-02 | Manual real-harness smoke runner                      | ✅ PASS | [see below](#m9-02-real-harness-smoke-runner)                                                            |
| M9-03 | Real Codex run end-to-end                             | ✅ PASS | [NGX-144](https://linear.app/ngxcalvin/issue/NGX-144) — Done 2026-04-28                                  |
| M9-04 | Real Claude run end-to-end                            | ✅ PASS | [NGX-145](https://linear.app/ngxcalvin/issue/NGX-145) — Done 2026-04-28                                  |
| M9-05 | Real OpenCode run end-to-end                          | ✅ PASS | [NGX-146](https://linear.app/ngxcalvin/issue/NGX-146) — Done 2026-04-28                                  |
| M9-06 | Mixed Claude + Codex real harness run                 | ✅ PASS | [NGX-147](https://linear.app/ngxcalvin/issue/NGX-147) — Done 2026-04-28                                  |
| M9-07 | Offline artifact integrity validator                  | ✅ PASS | [see below](#m9-07-artifact-integrity-validator)                                                         |
| M9-08 | Resume durability (no re-dispatch)                    | ✅ PASS | [see below](#m9-08-resume-durability)                                                                    |
| M9-09 | Doctor hardening (actionable messages)                | ✅ PASS | [see below](#m9-09-doctor-hardening)                                                                     |
| M9-10 | Clean clone quickstart matches README                 | ✅ PASS | [NGX-151](https://linear.app/ngxcalvin/issue/NGX-151) — Done 2026-04-28                                  |
| M9-11 | Packaged CLI install (pnpm pack)                      | ✅ PASS | [see below](#m9-11-packaged-cli-install)                                                                 |
| M9-12 | Release-readiness report (this doc)                   | ✅ PASS | —                                                                                                        |
| M10-01 | Orchestrator resolution output schema                | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime)                                                        |
| M10-02 | Orchestrator resolution prompt                       | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime)                                                        |
| M10-03 | Dispatch orchestrator between rounds                 | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime)                                                        |
| M10-04 | Populate round packet question resolutions           | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime)                                                        |
| M10-05 | Persist orchestrator passes (ledger/checkpoint/resume) | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime)                                                      |
| M10-06 | Docs, help text, e2e coverage for orchestrator mode  | ✅ PASS | [see below](#m10-orchestrator-resolution-runtime)                                                        |

All M9 issues (Release Readiness Gauntlet) and all M10 issues (Orchestrator Resolution Runtime) are **Done** in Linear, and both milestones report **100%**. The code, schema, and infrastructure gates carry inline evidence below; the real-harness gates (M9-03–M9-06, M9-10) were proven against live harness CLIs and closed in Linear on 2026-04-28.

---

## Current Verification Gates

The repeatable gates that gate every change on `main`. Local runs at the `swarm-v0.2.0` baseline pass all of these:

| Gate                | Command            | Scope                                                                  |
| ------------------- | ------------------ | ---------------------------------------------------------------------- |
| Unit tests          | `pnpm test`        | `vitest run` over `test/unit/**` (stubbed harnesses for determinism)   |
| Typecheck           | `pnpm typecheck`   | `tsc -p tsconfig.typecheck.json --noEmit`                              |
| Build               | `pnpm build`       | `tsdown` bundle + bundled-agent/preset copy into `dist/`               |
| Format              | `pnpm format:check`| `prettier --check src test`                                            |
| Lint                | `pnpm lint`        | `eslint src`                                                           |
| Smoke (golden path) | `pnpm smoke`       | builds, then `test/e2e/smoke.test.ts` — `swarm doctor` + `product-decision` end to end with a stubbed backend |

The `.no-mistakes.yaml` workflow runs `pnpm test` (tests) and `pnpm lint && pnpm typecheck && pnpm format:check` (lint) — keep all three green together when changing `src/`. CI and the e2e suite use **stubbed** harnesses for speed and determinism.

Real harness binaries are exercised by the **manual** `pnpm smoke:real` gate (not part of CI). It runs the built CLI against live `claude`/`codex`/`opencode` CLIs and emits a normalized JSON summary with offline artifact validation. See [CONTRIBUTING.md](../CONTRIBUTING.md#real-harness-smoke-gate-pnpm-smokereal) for usage and output shape.

---

## Passed Gates — Evidence

### M9-01 Codex JSON schema

**Issue:** [NGX-142](https://linear.app/ngxcalvin/issue/NGX-142)

`AGENT_OUTPUT_JSON_SCHEMA` in `src/backends/codex-cli.ts` sets `additionalProperties: false` at the root so the Codex CLI strict-schema validator accepts it.

```
Command: pnpm test -- test/unit/backends/codex-cli.test.ts
Result:  1 test file | 14 tests passed
Key assertion: schema.additionalProperties === false
```

### M9-02 Real-harness smoke runner

**Issue:** [NGX-143](https://linear.app/ngxcalvin/issue/NGX-143)

Added `src/scripts/real-harness-smoke.ts` (built to `dist/scripts/real-harness-smoke.mjs`) and a `pnpm smoke:real` convenience script. Supports `--harness`, `--topic`, `--preset`, `--rounds`, `--keep-artifacts`, `--base-dir`, `--cli-bin`, `--timeout-ms`, and emits a machine-readable JSON summary on stdout.

```
Command: pnpm build && node dist/scripts/real-harness-smoke.mjs --help
Entry:   src/scripts/real-harness-smoke.ts
Tests:   test/unit/lib/real-harness-smoke.test.ts — 15 tests passed (stub-backed)
Note:    Real harness invocation requires credentials; stub-backed unit tests prove
         runner logic (timeout, failure reasons, artifact discovery, JSON summary).
```

### M9-03–M9-06, M9-10 Real-harness gates

**Issues:** [NGX-144](https://linear.app/ngxcalvin/issue/NGX-144) (real Codex) · [NGX-145](https://linear.app/ngxcalvin/issue/NGX-145) (real Claude) · [NGX-146](https://linear.app/ngxcalvin/issue/NGX-146) (real OpenCode) · [NGX-147](https://linear.app/ngxcalvin/issue/NGX-147) (mixed Claude + Codex) · [NGX-151](https://linear.app/ngxcalvin/issue/NGX-151) (clean-clone quickstart)

All five real-harness gates were proven against live harness CLIs once credentials and installs were available and closed in Linear on 2026-04-28. Each real run produced a complete artifact set (`manifest.json`, `checkpoint.json`, `events.jsonl`, `messages.jsonl`, per-round output, and `synthesis.{json,md}`) with correct runtime metadata, validated by the same offline artifact validator wired into `pnpm smoke:real` (M9-07). The clean-clone gate confirmed the README quickstart works as written from a fresh checkout with no Calvin-only path assumptions.

> These gates depend on live harness binaries and credentials, so they are verified through the **manual** `pnpm smoke:real` gate rather than CI. Re-run `pnpm smoke:real --harness <name>` against the relevant CLI to reconfirm before a future release.

### M9-07 Artifact integrity validator

**Issue:** [NGX-148](https://linear.app/ngxcalvin/issue/NGX-148)

Added `src/lib/artifact-validator.ts` that schema-validates `manifest.json`, `checkpoint.json`, `events.jsonl`, `messages.jsonl`, and `synthesis.json`, checks required markdown artifacts (`seed-brief.md`, per-round `brief.md`, per-agent outputs, and completed-run `synthesis.md`) for existence, and cross-checks `runId` consistency between manifest and checkpoint. Integrated into `runRealHarnessSmoke` so real-harness smoke runs automatically validate artifacts.

```
Command: pnpm test -- test/unit/lib/artifact-validator.test.ts
Result:  21 tests passed
Command: pnpm test -- test/unit/lib/real-harness-smoke.test.ts
Result:  15 tests passed (includes 4 validator-integration tests)
```

### M9-08 Resume durability

**Issue:** [NGX-149](https://linear.app/ngxcalvin/issue/NGX-149)

E2E tests prove: completed rounds are not re-dispatched on resume, `events.jsonl` contains only resumed-run activity (no stale pre-crash events), and a 3-round run interrupted after round 2 resumes correctly dispatching only round 3.

```
Command: pnpm test:e2e -- test/e2e/durable-orchestration.test.ts
Result:  3 resume-specific tests passed (plus full durable-orchestration suite)
Tests:
  - resumed run dispatches only remaining rounds
  - resumed run events.jsonl reflects only the resumed run's agent activity
  - 3-round run interrupted after round 2 resumes with only round 3 dispatches
```

> Resume is implemented and covered by e2e durability tests via `resumeSwarm`, but it is **not yet surfaced as a user-facing `swarm` subcommand** — it remains internal/tooling-only at v0.2. A user-facing resume command is a v0.3 candidate.

### M9-09 Doctor hardening

**Issue:** [NGX-150](https://linear.app/ngxcalvin/issue/NGX-150)

`swarm doctor` failing harness checks now append `required by: <agentName>, ...` to the failure detail, naming the exact agent(s) that require the harness. Missing-binary checks surface actionable install messages.

```
Command: pnpm test -- test/unit/lib/doctor-backend.test.ts
Result:  5 new tests passed:
  - missing claude binary → actionable install message
  - missing codex binary → actionable install message
  - missing opencode binary → actionable install message
  - harness fail detail names the config agent requiring the harness
  - harness fail detail names the preset agent requiring the harness
```

### M9-11 Packaged CLI install

**Issue:** [NGX-152](https://linear.app/ngxcalvin/issue/NGX-152)

`pnpm pack` produces a tarball containing `dist/cli.mjs`, the bundled agents, and the bundled presets. Installed outside the repo (via `npm install <tarball>`), `swarm --version` returns the package version and `swarm doctor` exits 0 discovering bundled assets from the installed path.

```
Command: pnpm build && pnpm pack
Tarball: swarm-<version>.tgz
Contents verified:
  dist/cli.mjs
  dist/agents/bundled/
  dist/presets/bundled/

Command (temp dir outside repo):
  npm install /path/to/swarm-<version>.tgz
  ./node_modules/.bin/swarm --version   → package version
  ./node_modules/.bin/swarm doctor       → exit 0
```

### M10 Orchestrator Resolution Runtime

**Issues:** [NGX-154](https://linear.app/ngxcalvin/issue/NGX-154) · [NGX-155](https://linear.app/ngxcalvin/issue/NGX-155) · [NGX-156](https://linear.app/ngxcalvin/issue/NGX-156) · [NGX-157](https://linear.app/ngxcalvin/issue/NGX-157) · [NGX-158](https://linear.app/ngxcalvin/issue/NGX-158) · [NGX-159](https://linear.app/ngxcalvin/issue/NGX-159)

All 6 M10 slices are implemented and tested:

- **Schema** (`OrchestratorOutputSchema`) with validation helpers and repair-prompt support
- **Prompt builder** (`buildOrchestratorResolutionPrompt`) feeding source-packet context + output contract
- **Dispatcher** (`dispatchOrchestratorPass`) wired into `runSwarm`/`resumeSwarm` behind `resolveMode === 'orchestrator'` gate
- **Packet mutation** — orchestrator output populates `questionResolutions`, `questionResolutionLimit`, `deferredQuestions` in the next round's packet; synthesis aggregates deferred questions across all rounds
- **Persistence** — `orchestratorPasses[]` field in `checkpoint.json`; structured `orchestrator:pass` event metadata in `events.jsonl`; rehydration on resume
- **Docs** — `--resolve` help text updated, README Resolution modes table added, e2e test proves `--resolve orchestrator` produces non-empty resolution artifacts

```
Command: pnpm test && pnpm test:e2e
Result:  unit + e2e suites passed
Command: pnpm lint && pnpm typecheck && pnpm format:check
Result:  all clean
```

---

## Reserved / Not-Yet-Contract Behavior

The following are accepted by the CLI but are **not** part of the v0.2 alpha contract (they are documented as reserved in the README and behave conservatively):

- **`--resolve agents`** — accepted and persisted in `manifest.json`/`synthesis.json` but currently behaves like `off`. Kept on the CLI surface so future agent-driven resolution can land without a flag rename.
- **`rounds` config key** — reserved in `.swarm/config.yml` but not yet applied; pass `<rounds>` on the CLI.
- **User-facing resume command** — `resumeSwarm` is implemented and tested but not exposed as a `swarm` subcommand yet.

---

## Productionization path (M11–M15)

The alpha runtime is feature-complete for dogfood. The next phase is productionization, tracked by these Linear milestones:

| Milestone | Theme                                       | Intent                                                                                       |
| --------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **M11**   | Alpha Closeout and Status Reconciliation    | Refresh stale readiness/status docs and establish the productionization baseline (this work). |
| **M12**   | Public Repo Shell and Release Operations    | CI, issue/PR templates, community files, and release-operation docs to a public-repo standard. |
| **M13**   | Docs Site, Spec, and Install Guide          | A public docs/spec/install layer so the README can stay concise and authoritative.            |
| **M14**   | Agent DX and Dogfood Recipes                | Make Swarm reliable for agents to operate and dogfood on real decisions.                       |
| **M15**   | Runtime Boundary Refactor                   | After contracts are documented, split the runtime into clearer, behavior-preserving boundaries. |

### To cut a future (non-alpha) release

1. Re-run the real-harness gate for each target harness: `pnpm smoke:real --harness <claude|codex|opencode>` and a mixed run.
2. Confirm the current verification gates (`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`, `pnpm lint`, `pnpm smoke`).
3. Land the corresponding M12–M15 work for the release scope.
4. Let Release Please open/update the release PR from Conventional Commits on `main`, then merge it to tag and publish the GitHub Release.
5. Update this report with the new version and re-verified gate evidence.
</content>
</invoke>
