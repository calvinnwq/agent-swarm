# M15 Runtime Boundary Refactor — Closeout & Parity Verification

Closeout record for the M15 milestone (NGX-474, NGX-475, NGX-476, NGX-477):
**Runtime Boundary Refactor**. M15 split the two largest runtime files into
behavior-preserving modules mapped to [ARCHITECTURE.md](../ARCHITECTURE.md). This
note records the changed boundaries, the parity evidence that proves no
user-visible behavior moved, and the candidates that are now grounded in the
updated architecture for v0.3. It exists so the refactor's parity claim is
visible without reading PR history.

**Baseline:** `3a7a38d` (pre-M15 `main`) — the last commit before
`test/unit/architecture-contract.test.ts` landed.
**Verified at:** package version `0.4.0`, branch
`feat/ngx-477-m15-runtime-boundary-refactor` (M15 PRs #57/#58/#59 already merged
to `main`).
**Date:** 2026-06-21.

## What changed (boundaries)

M15 was a behavior-preserving extraction. No schema, persisted-artifact format,
CLI flag, or exit code changed; code moved between layers along the boundaries
documented in [ARCHITECTURE.md](../ARCHITECTURE.md) §1–2.

- **Architecture-contract tests (NGX-474).**
  `test/unit/architecture-contract.test.ts` (212 lines) locks `src/cli.ts` as a
  thin entrypoint and asserts the documented CLI/source ownership before any code
  moved, so the later extractions could not silently drift behavior into the
  wrong layer. Docs/AGENTS now point at this contract.
- **CLI routing extraction (NGX-475).** `src/cli.ts` shrank from **278 → 8
  lines** (a bin shim that reads the version and hands argv to `runCli`). Command
  routing, config layering, and dispatch moved into `src/lib/cli-program.ts` (297
  lines). No public CLI behavior or error codes changed.
- **`runSwarm` split (NGX-476).** `src/lib/run-swarm.ts` shrank from **1067 →
  458 lines**. The shared pipeline core that `runSwarm` and `resumeSwarm` once
  duplicated now lives in focused modules:
  - `round-loop.ts` (238) — shared round-lifecycle emitter wiring +
    run-event factory (`attachRoundLoopHandlers`, `createRunEventFactory`).
  - `between-rounds.ts` (218) — the shared between-rounds pass
    (`createBetweenRounds`, `OrchestratorDispatchError`).
  - `execute-run.ts` (102) — the shared UI-attach → run → finalize → synthesis
    tail (`executeRun`), parameterized only by `priorRoundResults`.
  - `round-results.ts` (66) — the checkpoint/live round-result serialization seam
    (`checkpointRoundResults` / `restoreCheckpointRoundResults`).
  - `resolution-context.ts` (74) — the prior-pass question-resolution fold for the
    orchestrator path.
- **Docs synced to the new map.** `ARCHITECTURE.md`, `AGENTS.md`/`CLAUDE.md`,
  `CONTRIBUTING.md`, `SPEC.md`, `README.md`, and `docs/release-readiness.md` were
  updated to describe the landed module boundaries (no behavior claims changed).

## Behavior parity evidence

The refactor preserves behavior, established by:

1. **Architecture-contract test (NGX-474)** guards the CLI/source boundaries the
   extraction had to respect — it fails if routing/runtime behavior drifts into
   the wrong layer.
2. **Per-module unit tests** were added alongside each extracted seam:
   `between-rounds.test.ts` (343), `execute-run.test.ts` (359),
   `round-loop.test.ts` (368), `round-results.test.ts` (139),
   `resolution-context.test.ts` (124), `cli-program.test.ts` (48). Resume,
   orchestrator dispatch, ledger/artifact/checkpoint persistence, and synthesis
   stay covered by the pre-existing suite, which still passes unchanged.
3. **End-to-end suite runs the real built bundle.** `pnpm test:e2e` /
   `pnpm smoke` shell out to the actual `dist/cli.mjs`, exercising the full
   pipeline (config layering → per-agent dispatch → round runner → between-rounds
   → append-only persistence → deterministic synthesis → resume) against the
   shipped bundle. Only the harness CLI shell-out is stubbed, and the harness
   adapters (`src/backends/*-cli.ts`) were **not** touched by M15.
4. **Stable contracts.** No Zod schema, persisted artifact format
   (`manifest.json`, `checkpoint.json`, `events.jsonl`, `messages.jsonl`,
   `synthesis.json/.md`, round folders), CLI flag, or exit code was modified.

## What was verified

Full local gates were run at the merged M15 state on 2026-06-21:

| Gate               | Command                        | Result                                                        |
| ------------------ | ------------------------------ | ------------------------------------------------------------- |
| Format             | `pnpm format:check`            | ✅ exit 0 — "All matched files use Prettier code style!"      |
| Lint               | `pnpm lint`                    | ✅ exit 0 — `eslint src`, no findings                         |
| Typecheck          | `pnpm typecheck`               | ✅ exit 0 — `tsc -p tsconfig.typecheck.json --noEmit`         |
| Unit               | `pnpm test`                    | ✅ exit 0 — 65 files / 1151 tests                             |
| Build              | `pnpm build`                   | ✅ exit 0 — `dist/cli.mjs` 139.40 kB + bundled agents/presets |
| E2E smoke (golden) | `pnpm smoke`                   | ✅ exit 0 — 1 file / 99 tests                                 |
| E2E (full)         | `pnpm test:e2e`                | ✅ exit 0 — 9 files / 135 tests                               |
| Whitespace/diff    | `git diff --check main...HEAD` | ✅ no errors                                                  |

The full e2e run prints a `[round 1] … FAILED … No canned output` line: that is
an intentional failure-path test asserting stub-harness behavior, not a gate
failure — the suite reports `9 passed (9)`.

### Real-harness smoke (`pnpm smoke:real`)

Recorded as a **deliberately deferred manual release gate**, consistent with the
[ARCHITECTURE.md](../ARCHITECTURE.md) §5 contract that `smoke:real` is not part of
`pnpm test`, `pnpm test:e2e`, or CI, and the M11 closeout precedent. Rationale:

- M15 did not touch the harness adapters (`claude-cli.ts`, `codex-cli.ts`,
  `opencode-cli.ts`, `rovo-acli.ts`) that `smoke:real` exercises; the e2e suite
  already drives the refactored orchestration through the real built bundle.
- `acli` (rovo) is not installed in this environment, and running the real
  `claude`/`codex`/`opencode` CLIs needs interactive auth and consumes real
  provider tokens — out of scope for an automated refactor-parity check.

`smoke:real` remains the manual gate to run before any release that ships
runtime-dispatch changes; M15 ships none.

## Remaining risks / v0.3 candidates (grounded in the updated architecture)

The updated [ARCHITECTURE.md](../ARCHITECTURE.md) §7 now provides concrete module
boundaries for the next behavior-preserving cleanups, so any future v0.3 issue
can reference real seams rather than a monolith:

- **Persistence interface.** `OutputRouter` → three writers
  (`artifact-writer`, `ledger-writer`, `checkpoint-writer`) could be isolated
  behind a narrower persistence interface (ARCHITECTURE.md §2 / §7).
- **Adapter seam.** The run-level `BackendAdapter` (metadata / `wrapperName`)
  vs. per-agent harness adapters (dispatch) seam could be clarified further
  (ARCHITECTURE.md §3 step 3).
- **Reserved `--resolve agents` path.** `between-rounds.ts` is now structured so
  a future agents-resolution pass can slot in without touching the round runner;
  this stays non-contract until that work lands.

No new Linear issues are created as part of this closeout (M15 scope is the four
M15-0x tickets); these candidates remain tracked under the productionization
roadmap in [docs/release-readiness.md](release-readiness.md).

## Release decision

No release is required for M15. The refactor is behavior-preserving and the
extracted modules use `refactor:`/`test:`/`docs:` Conventional Commits, which
Release Please does not treat as release-driving. The next version bump should
ride v0.3 implementation work, not the M15 closeout.
