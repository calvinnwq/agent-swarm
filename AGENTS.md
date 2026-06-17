# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

`agent-swarm` is a TypeScript CLI that fans out 2–5 agents in parallel rounds (1–3 rounds), collects structured JSON output, and produces a deterministic synthesis. Built as ESM, distributed as a single `dist/cli.mjs` bin via `tsdown`. Node ≥ 20 (24 LTS pinned in `.nvmrc`), pnpm 10.

Product/storage identity is centralized in `src/lib/identity.ts` (`PRODUCT_NAME`, `CLI_NAME = "agent-swarm"`, `STORAGE_DIR = ".agent-swarm"`, legacy `.swarm`). The CLI stores project/user data under `.agent-swarm/`; the legacy `.swarm/` paths are still read as a fallback for at least one release (new path wins when both exist). Don't hardcode either path — use the constants.

The README is the authoritative user-facing entry point — when alpha behavior is ambiguous, README contracts win. `SPEC.md` is the durable alpha contract, `INSTALL.md` is the step-by-step setup/troubleshooting guide, and `ARCHITECTURE.md` is the contributor runtime map.

## Commands

```bash
pnpm build           # tsdown bundle + copies bundled agents/presets into dist/
pnpm dev             # tsdown --watch
pnpm test            # vitest unit tests (test/unit/**)
pnpm test:e2e        # builds, then vitest with vitest.e2e.config.ts (test/e2e/**)
pnpm smoke           # builds, runs only test/e2e/smoke.test.ts (golden-path verification)
pnpm smoke:real      # builds, then runs real harness CLIs manually (not CI)
pnpm typecheck       # tsc -p tsconfig.typecheck.json --noEmit
pnpm lint            # eslint src
pnpm format          # prettier --write src test
pnpm format:check    # prettier --check src test
```

Run a single test file: `vitest run test/unit/path/to/file.test.ts` (or `--config vitest.e2e.config.ts` for e2e). Filter by name: `vitest run -t "pattern"`.

The `.no-mistakes.yaml` workflow runs `pnpm install --frozen-lockfile && pnpm test` for tests and `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm format:check` for lint — keep all three green together when changing src.

After build, `pnpm link --global` exposes the `agent-swarm` bin. The bin is `dist/cli.mjs`; bundled agent/preset YAML files must be copied into `dist/agents/bundled/` and `dist/presets/bundled/` (the `build` script does this — don't edit `dist/` by hand).

## Releases

Release Please manages GitHub releases from Conventional Commits on `main`. Use
release-driving commit types such as `feat:`, `fix:`, and `deps:` for changes
that should appear in the next release. Non-release work can use types such as
`docs:`, `test:`, `refactor:`, `chore:`, or the existing project-specific
scopes.

The `.github/workflows/release-please.yml` workflow opens or updates a Release
Please PR. Merging that PR updates `package.json`, writes `CHANGELOG.md`,
creates a git tag, and creates the GitHub Release. npm publishing is not part of
the current release workflow.

Release Please is configured with `package-name: @calvinnwq/agent-swarm`,
`include-component-in-tag: false`, `include-v-in-tag: true`, and
`include-v-in-release-name: true`, so tags and release titles use plain version
format (`vX.Y.Z`). The pre-npm GitHub releases were retagged to this format as
part of NGX-478; do not recreate legacy component-prefixed release tags.

The npm package is scoped as `@calvinnwq/agent-swarm`, but the executable bin is
still `agent-swarm`. Do not publish npm packages, change package access, create
or delete tags, edit GitHub releases, or configure trusted publishing without
explicit approval. The operator runbook is
`docs/release-operations.md`; follow it before any release/publish action.

## Architecture

### Pipeline (src/lib/run-swarm.ts)

`runSwarm` is the orchestrator. Lifecycle per run:

1. **Resolve config + agents.** `cli.ts` layers CLI flags > project config (`.agent-swarm/config.yml`, legacy `.swarm/config.yml` fallback) > preset defaults, then loads `AgentRegistry` and resolves each agent's runtime (`resolveAgentRuntimes`). When `resolveMode === "orchestrator"`, it also includes the bundled `orchestrator` agent in runtime resolution; without a run-level backend override, homogeneous selected-agent harnesses are inferred onto that orchestrator agent.
2. **Resolve harnesses per agent.** Each agent picks a harness in this order: `agent.harness` → run-level `--backend`/`config.backend` → `agent.backend`. Harness ≠ backend: `BackendId` is `claude | codex` (the run-level dial), `HarnessId` is `claude | codex | opencode | rovo` (per-agent dispatch). `assertResolvedRuntimesAvailable` fails fast on unimplemented harnesses.
3. **Per-agent dispatch.** `createAgentAdapterResolver` returns a `BackendAdapter` per agent based on its resolved harness; `round-runner.ts` calls that adapter (not the run-level `backend`) for the actual CLI shell-out. The run-level `backend` is still used for run metadata (`wrapperName`).
4. **Round execution.** `createRoundRunner` runs agents in parallel with `DEFAULT_CONCURRENCY = 3`, `config.timeoutMs` (default `DEFAULT_DISPATCH_TIMEOUT_MS = 120_000`), and one `MAX_FORMAT_REPAIR_ATTEMPTS` retry when JSON parse fails. Output is validated against `AgentOutputSchema` (Zod).
5. **Between rounds.** `betweenRounds` builds the next directive from the prior packet. In `resolveMode === "orchestrator"`, `orchestrator-dispatcher.ts` calls the bundled `orchestrator` agent with the same `config.timeoutMs` for a structured `OrchestratorOutput`; otherwise it uses the deterministic templated directive. The directive is staged as a broadcast `MessageEnvelope` for the selected next-round recipients (via `selectAgentsForRound`), `orchestratorPasses` and `pendingBetweenRounds` are persisted for resume, and failed orchestrator dispatch finalizes the run as failed.
6. **Persistence.** Three append-only writers fan out from `OutputRouter`: `ArtifactWriter` (round folders + manifest), `LedgerWriter` (`events.jsonl` + `messages.jsonl`), `CheckpointWriter` (`checkpoint.json`). Round writes happen on `round:done` and are awaited in `betweenRounds` so checkpoint ordering is deterministic.
7. **Synthesis.** `buildOrchestratorSynthesis` is fully deterministic (no LLM call) — consensus, stance tally, top recommendation by confidence with alphabetical tie-break, shared risks (≥2 agents), deferred questions across all rounds, rounded average confidence.

`resumeSwarm` rehydrates from `checkpoint.json` + the message ledger, reloads optional carry-forward doc snapshots and prior orchestrator pass state, reuses the same `runDir`/`runId`, skips `ArtifactWriter.init()` (would clobber `manifest.json`/`seed-brief.md`), and restarts from `lastCompletedRound + 1`. Synthesis on resume concatenates `resumedRoundResults` with `result.rounds`.

### Backend & harness layering (src/backends/)

- `factory.ts` → `createBackendAdapter(BackendId)` for the run-level adapter (claude or codex only).
- `harness-adapter.ts` → `createHarnessAdapter(HarnessId)` and `HarnessAdapterRegistry` (cached per harness). `buildHarnessAdapterRegistry` pre-warms one adapter per resolved harness; `createAgentAdapterResolver` returns a function `(AgentDefinition) => BackendAdapter` so each agent's dispatch is decoupled from the run-level backend.
- Each adapter (`claude-cli.ts`, `codex-cli.ts`, `opencode-cli.ts`, `rovo-acli.ts`) shells out to the matching CLI via `execa`. Model selection is harness-specific: `claude --model`, `codex -m`, `opencode --model`, `acli rovodev run --model`.
- `harness-capability.ts` runs the auth/version probes consumed by `agent-swarm doctor`.

### Registries (project > user > bundled)

`AgentRegistry` (`src/lib/agent-registry.ts`) and `PresetRegistry` (`src/lib/preset-registry.ts`) load from three roots, first match wins:

| Scope   | Agents                                    | Presets                        |
| ------- | ----------------------------------------- | ------------------------------ |
| Project | `.agent-swarm/agents/*.yml` / `.md`       | `.agent-swarm/presets/*.yml`   |
| User    | `~/.agent-swarm/agents/*.yml` / `.md`     | `~/.agent-swarm/presets/*.yml` |
| Bundled | `src/agents/bundled/` (copied to `dist/`) | `src/presets/bundled/`         |

Within each scope, the current `.agent-swarm/` root is searched before the legacy `.swarm/` root, so the registries resolve roots as: project-current, project-legacy, user-current, user-legacy, bundled. Same-name override across scopes is allowed (current beats legacy beats bundled); duplicates inside one root are an error. Markdown agents use YAML frontmatter validated against the same Zod schema as `.yml` agents.

### Schemas (src/schemas/)

All cross-boundary contracts are Zod schemas (no hand-rolled types). Important ones: `AgentOutputSchema` (the JSON each agent must return), `OrchestratorOutputSchema`, `RunManifest`, `RunCheckpoint`, `RunEvent`, `MessageEnvelope`, `RoundPacket`, `ResolvedAgentRuntime`. `BackendId` and `HarnessId` are deliberately separate schemas — don't conflate them when adding new dispatch paths.

### Constraints baked into validation

`parse-command.ts` enforces: rounds 1–3, agents 2–5, lowercase agent name with `-`/`_` only, resolve mode `off | orchestrator | agents` (with synonyms). Errors are thrown as `SwarmCommandError` and surface to the user with exit code `2`.

### Run artifacts (`.agent-swarm/runs/<ts>-<slug>/`)

`manifest.json`, `checkpoint.json`, `events.jsonl`, `messages.jsonl`, `seed-brief.md`, optional `carry-forward-docs/{manifest.json,doc-NN.md}` snapshots, `round-NN/{brief.md,agents/<name>.md}`, `synthesis.json`, `synthesis.md`. Per-agent markdown headers include `Harness:` / `Model:` when `agentRuntimes` is present in the manifest.

### Terminal UI (src/ui/)

`live-renderer.ts` is the default for TTY (cell-based diff render to avoid flicker); `quiet-logger.ts` is one-line-per-event for CI/non-TTY. Mode is auto-selected from `process.stderr.isTTY` unless `--quiet` (or `ui: "silent"` in tests) is set.

## Conventions

- **ESM only.** Imports use `.js` extensions even for `.ts` source (TS `moduleResolution: "bundler"`). Don't drop the extension.
- **Strict TS.** `tsconfig.json` is strict. Prefer Zod-inferred types (`z.infer<typeof Schema>`) over hand-rolled interfaces for any data that crosses the disk/wire boundary.
- **No new error-handling for impossible states.** Validation lives at boundaries (CLI parsing, schema decode, harness probe) — internal callers can trust resolved values.
- **Don't edit `dist/`.** Always rebuild via `pnpm build`. The build step also copies `src/agents/bundled/*` and `src/presets/bundled/*` — adding a new bundled agent/preset means adding the YAML, no code wiring needed.
- **Tests are split.** Unit tests under `test/unit/` mirror `src/` layout and run via `pnpm test`. End-to-end tests under `test/e2e/` build the CLI and shell out to it; they require `pnpm test:e2e` (which builds first). `pnpm smoke` is the minimal e2e subset to run before cutting an alpha release.
- **`agent-swarm doctor` before claiming a run works.** It validates project config, configured docs, agent/preset registries, backend compatibility, and probes harness CLIs for auth. It also reports explicitly when project config is read from the legacy `.swarm/config.yml` path. Exit codes: `0` ok, `1` checks failed, `2` internal error — match this convention if adding new diagnostics.
