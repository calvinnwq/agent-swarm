# Agent Swarm — Architecture

This document maps the runtime: its module boundaries, the `runSwarm` lifecycle,
and the invariants that keep the alpha contract stable. It is a contributor
reference; for the user-facing contract see [SPEC.md](SPEC.md) and the
[README](README.md). [CONTRIBUTING.md](CONTRIBUTING.md) carries the dev loop and
a condensed version of this map.

Agent Swarm is an ESM TypeScript CLI bundled with `tsdown` into a single
`dist/cli.mjs` bin. Node ≥ 20 (24 LTS pinned), pnpm 10.

---

## 1. Layers at a glance

```
cli.ts (bin shim)             read version, hand argv to runCli
  └─ cli-program.ts           Commander routing: run/init/doctor, layer config, dispatch
       └─ parse-command.ts        validate args → SwarmCommandError on bad input
       └─ load-project-config.ts  .agent-swarm/config.yml (legacy .swarm fallback)
       └─ init-config.ts          deterministic .agent-swarm/config.yml writer
       └─ registries              AgentRegistry, PresetRegistry (project>user>bundled)
       └─ harness-resolution.ts   per-agent (harness, model) resolution
        │
        ▼
run-swarm.ts (runSwarm/resumeSwarm)   pipeline orchestrator
  ├─ round-runner.ts          concurrent per-agent dispatch
  │    └─ harness adapters     claude/codex/opencode/rovo CLI shell-outs
  ├─ orchestrator-dispatcher  between-round LLM pass (resolve=orchestrator)
  ├─ output-router.ts         fans writes to three append-only writers
  │    ├─ artifact-writer.ts   round folders + manifest
  │    ├─ ledger-writer.ts     events.jsonl + messages.jsonl
  │    └─ checkpoint-writer.ts checkpoint.json
  └─ synthesis.ts             deterministic synthesis (no LLM)
        │
        ▼
ui/ (live-renderer | quiet-logger)    terminal rendering
```

---

## 2. Module map

### CLI and command routing (`src/cli.ts`, `src/lib/cli-program.ts`, `src/lib/parse-command.ts`)

`cli.ts` is the bin entry and is intentionally **thin**: it reads the package
version and hands argv to `runCli` (`src/lib/cli-program.ts`). `cli-program.ts`
owns command routing — it builds the Commander program, registers the `run`,
`init`, and `doctor` commands, layers configuration, builds a `SwarmRunConfig`,
and hands off to `runSwarm` for runs, `runDoctor` for diagnostics, or
`initProjectConfig` for the deterministic config writer. `parse-command.ts` owns
argument validation (rounds 1–3, agents 2–5, resolve-mode synonyms) and throws
`SwarmCommandError`, which surfaces with exit code `2`. Agent and preset schemas
own definition-name validation. Run dispatch returns an exit code; `doctor`
exits `0`/`1`/`2`; `init` exits `0` on create/overwrite/preserve and `2` on
command errors.

### Config loading (`src/lib/load-project-config.ts`, `src/lib/config.ts`, `src/schemas/swarm-config.ts`)

Project config is loaded from `.agent-swarm/config.yml`, with the legacy
`.swarm/config.yml` read only when the current path is absent. The strict
`SwarmProjectConfigSchema` rejects unknown keys. `config.ts` defines the
`SwarmRunConfig` shape consumed by the pipeline. Precedence is **CLI flags >
config values > preset defaults**, resolved in `cli-program.ts`.

`src/lib/init-config.ts` backs `agent-swarm init`: it creates or, with `--force`,
overwrites only `.agent-swarm/config.yml` with minimal defaults (`preset:
product-triad`, `resolve: off`, `timeoutMs: 300000`). It reports a legacy
`.swarm/config.yml` when present but never mutates the legacy path.

### Registries (`src/lib/agent-registry.ts`, `src/lib/preset-registry.ts`)

`AgentRegistry` and `PresetRegistry` load from project → user → bundled roots,
with current `.agent-swarm/` searched before legacy `.swarm/` inside each scope.
First match wins; duplicate names within one root are an error. Bundled YAML
lives under `src/agents/bundled/` and `src/presets/bundled/` and is copied into
`dist/` by the build — adding a bundled agent/preset is a YAML drop, no code
wiring. Markdown agents are validated against the same Zod schema as `.yml`.

### Harness/backend adapters (`src/backends/`, `src/lib/harness-*.ts`)

- `factory.ts` → `createBackendAdapter(BackendId)` builds the run-level adapter
  (claude or codex only) used for run metadata (`wrapperName`).
- `harness-adapter.ts` → `createHarnessAdapter(HarnessId)` plus a cached
  `HarnessAdapterRegistry`. `buildHarnessAdapterRegistry` pre-warms one adapter
  per resolved harness; `createAgentAdapterResolver` returns
  `(AgentDefinition) => BackendAdapter` so each agent's dispatch is decoupled
  from the run-level backend.
- Adapters (`claude-cli.ts`, `codex-cli.ts`, `opencode-cli.ts`, `rovo-acli.ts`)
  shell out via `execa`. Model selection is harness-specific: `claude --model`,
  `codex -m`, `opencode --model`, `acli rovodev run --model`.
- `harness-resolution.ts` resolves each agent's `(harness, model)` pair;
  `harness-capability.ts` runs the auth/version probes consumed by `doctor`;
  `harness-registry.ts` describes harness availability.

### Schemas (`src/schemas/`)

All cross-boundary contracts are Zod schemas (no hand-rolled types). Key ones:
`AgentOutputSchema`, `OrchestratorOutputSchema`, `RunManifest`, `RunCheckpoint`,
`RunEvent`, `MessageEnvelope`, `RoundPacket`, `ResolvedAgentRuntime`. `BackendId`
and `HarnessId` are deliberately separate schemas.

### UI (`src/ui/`)

`live-renderer.ts` (cell-based diff render, default on TTY) and
`quiet-logger.ts` (one-line-per-event for CI/non-TTY). Mode auto-selects from
`process.stderr.isTTY` unless `--quiet` / `ui: "silent"`.

---

## 3. `runSwarm` lifecycle

`runSwarm` (`src/lib/run-swarm.ts`) is the orchestrator. Per run:

1. **Resolve config + agents.** `cli-program.ts` layers flags > config > preset,
   loads `AgentRegistry`, and resolves runtimes via `resolveAgentRuntimes`. With
   `resolveMode === "orchestrator"`, the bundled `orchestrator` agent is included
   in runtime resolution; absent a run-level backend override, homogeneous
   selected-agent harnesses are inferred onto the orchestrator.
2. **Resolve harnesses per agent.** `agent.harness` → run-level backend →
   `agent.backend`. `assertResolvedRuntimesAvailable` fails fast on unimplemented
   harnesses.
3. **Per-agent dispatch.** `createAgentAdapterResolver` yields a per-agent
   adapter from the resolved harness; `round-runner.ts` calls that adapter, not
   the run-level backend.
4. **Round execution.** `createRoundRunner` runs agents in parallel with
   `DEFAULT_CONCURRENCY = 3`, `config.timeoutMs` (default
   `DEFAULT_DISPATCH_TIMEOUT_MS = 120_000`), and one `MAX_FORMAT_REPAIR_ATTEMPTS`
   retry on JSON parse failure. Output is validated against `AgentOutputSchema`.
5. **Between rounds.** `betweenRounds` builds the next directive from the prior
   packet. In `orchestrator` mode, `orchestrator-dispatcher.ts` calls the bundled
   orchestrator (same `config.timeoutMs`) for a structured `OrchestratorOutput`;
   otherwise the directive is templated. The directive is staged as a broadcast
   `MessageEnvelope` for the next-round recipients (via `selectAgentsForRound` in
   `scheduler.ts`); `orchestratorPasses` and `pendingBetweenRounds` are persisted
   for resume; a failed orchestrator dispatch finalizes the run as failed.
   `resolution-context.ts` folds prior-pass question resolutions and deferred
   questions into the packet before each orchestrator pass.
6. **Persistence.** Three append-only writers fan out from `OutputRouter`. Round
   writes happen on `round:done` and are awaited in `betweenRounds` so checkpoint
   ordering is deterministic.
7. **Synthesis.** `buildOrchestratorSynthesis` is fully deterministic — consensus,
   stance tally, top recommendation by confidence (alphabetical tie-break),
   shared risks (≥2 agents), deferred questions across rounds, rounded average
   confidence.

### Resume

`resumeSwarm` rehydrates from `checkpoint.json` plus the message ledger, reloads
optional carry-forward doc snapshots and prior orchestrator pass state, reuses
the same `runDir`/`runId`, skips `ArtifactWriter.init()` (which would clobber
`manifest.json`/`seed-brief.md`), and restarts from `lastCompletedRound + 1`.
`round-results.ts` owns the serialization seam between live round results and the
durable checkpoint shape (`checkpointRoundResults` / `restoreCheckpointRoundResults`).
`round-loop.ts` owns the shared round-lifecycle emitter wiring
(`attachRoundLoopHandlers`) and the run-event factory (`createRunEventFactory`), so
both `runSwarm` and `resumeSwarm` stage briefs, commit inbox messages, append ledger
events, and write round artifacts/checkpoints identically rather than duplicating the
handlers. `between-rounds.ts` owns the shared between-rounds pass itself
(`createBetweenRounds`, plus the `OrchestratorDispatchError` it throws, re-exported from
`run-swarm.ts`): the pending-write await, the two checkpoints, the deterministic-or-
orchestrator directive, and the broadcast staging — parameterized only by the run start
timestamp so both entry points share one implementation. `execute-run.ts` owns the shared
run-execution tail (`executeRun`): it attaches the UI renderer then the round-loop handlers,
drives the round runner to completion, finalizes the run (or fails it on an escaping
`OrchestratorDispatchError`), and writes the deterministic synthesis — parameterized only by
`priorRoundResults`, which is empty for a fresh run and the rehydrated rounds on resume, so
synthesis on resume concatenates `resumedRoundResults` with `result.rounds`.
Resume is implemented and tested but **not** exposed as a user-facing
subcommand in the alpha (see [SPEC.md](SPEC.md) §10).

---

## 4. Doctor (`src/lib/doctor.ts`)

`agent-swarm doctor` is the canonical diagnostic surface. It validates project
config parsing, configured docs, the agent/preset registries, backend
compatibility (`backend-selection.ts`), and — when a project config is present —
probes resolved harness CLIs for auth via `harness-capability.ts`. It reports
explicitly when config is read from the legacy `.swarm/config.yml` path. Exit
codes: `0` ok, `1` checks failed, `2` internal error. New diagnostics should
match this convention.

---

## 5. Real-harness smoke (`src/lib/real-harness-smoke.ts`, `src/scripts/real-harness-smoke.ts`)

`pnpm smoke:real` is a **manual release gate**, not part of `pnpm test`,
`pnpm test:e2e`, or CI (those use stubbed harnesses for speed/determinism). It
runs the built CLI against real harness binaries and prints a normalized JSON
summary; offline artifact validation (`artifact-validator.ts`) confirms each
run's artifact set. Per-pass `failureReason` is one of `harness-binary-missing |
swarm-run-nonzero | swarm-run-timeout | artifact-dir-not-found |
artifact-validation-failed`. See [CONTRIBUTING.md](CONTRIBUTING.md) for flags and
output shape.

---

## 6. Invariants

These hold across the runtime and should be preserved by any change:

- **Thin CLI.** `cli.ts` is a bin shim that reads the version and hands argv to
  `runCli`; command routing, config layering, and dispatch live in
  `src/lib/cli-program.ts`. Behavior lives in `src/lib/`, not the bin entry.
- **ESM only, `.js` import specifiers.** TS source imports use `.js` extensions
  (`moduleResolution: "bundler"`). Don't drop the extension.
- **Zod at every boundary.** All disk/wire-crossing data is a Zod schema; prefer
  `z.infer<typeof Schema>` over hand-rolled interfaces. No defensive code for
  impossible internal states — validation lives at the boundaries.
- **Harness ≠ backend.** `BackendId` (`claude | codex`) is the run-level dial;
  `HarnessId` (`claude | codex | opencode | rovo`) is per-agent dispatch. Keep the
  schemas separate.
- **Append-only durable artifacts.** Events, messages, and checkpoints are
  written incrementally; round writes are awaited so checkpoint ordering is
  deterministic and a failed run is inspectable/resumable.
- **`.agent-swarm/` writes, `.swarm/` read fallback.** New writes always target
  `.agent-swarm/`; legacy `.swarm/` paths are read-only fallbacks and the current
  path wins when both exist. Use the `src/lib/identity.ts` constants — never
  hardcode either path.
- **Deterministic synthesis.** Synthesis never calls an LLM; given the same
  agent outputs it produces the same report.
- **Don't edit `dist/`.** Always rebuild via `pnpm build`, which also copies
  bundled agents/presets into `dist/`.

---

## 7. M15 runtime refactor candidates

The M15 milestone (Runtime Boundary Refactor) builds on the architecture
contracts locked in by `test/unit/architecture-contract.test.ts` (NGX-474),
which guards the boundaries documented here and in [SPEC.md](SPEC.md) so the
following behavior-preserving boundary cleanups can move code between layers
deliberately. Candidate cleanups include:

- The `runSwarm` / `resumeSwarm` split now shares its whole pipeline core rather
  than duplicating it: `round-loop.ts` (lifecycle handlers + run-event factory),
  `between-rounds.ts` (between-rounds pass), and `execute-run.ts` (`executeRun`,
  the UI-attach → run → finalize → synthesis tail) leave each entry point as just
  its own setup/rehydration plus a single `executeRun` call.
- Clarifying the seam between run-level `BackendAdapter` (metadata) and per-agent
  harness adapters (dispatch).
- Isolating the `OutputRouter` → writers fan-out behind a narrower persistence
  interface.
- Between-round orchestration is now extracted into `between-rounds.ts`
  (`createBetweenRounds`, shared by `runSwarm`/`resumeSwarm`) on top of
  `orchestrator-dispatcher.ts`, so a future `--resolve agents` path can slot in
  without touching the round runner or duplicating the pass.

These are candidates only; they must preserve the alpha contract and are tracked
under the productionization roadmap (see
[docs/release-readiness.md](docs/release-readiness.md)).
