# M11 Alpha Closeout & Status Reconciliation

Closeout record for the M11 milestone (NGX-459, NGX-460, NGX-461). This is a
docs-only change — no runtime behavior was modified. It exists so the project's
completed-alpha state and productionization intent are visible without reading
chat history.

**Baseline:** `swarm-v0.2.0` on `main` (package version `0.2.0`).  
**Date:** 2026-06-16.

## What changed

- **`docs/release-readiness.md` (NGX-459)** — Rewritten from the stale v0.1.0
  "NOT RELEASE READY" report. The real-harness gates (NGX-144–NGX-147, NGX-151)
  are now ✅ PASS, matching Linear (all M9/M10 issues Done; Release Readiness
  Gauntlet and Orchestrator Resolution Runtime milestones at 100%). The old
  "blocked" status is preserved only as a dated history note, not as current
  truth. Added a Current Verification Gates table, a Reserved/Not-Yet-Contract
  section, and the M11–M15 productionization path.
- **`README.md` (NGX-460)** — Reframed the alpha banner to state the v0.2 alpha
  runtime is feature-complete and dogfood-ready, and added a **Status & roadmap**
  section that separates Supported (the v0.2 contract), Reserved (`--resolve
  agents`, the `rounds` config key), and Future v0.3+ candidates. Supported
  commands, quickstart, artifact descriptions, and reserved-feature caveats were
  preserved; no command examples or behavior claims changed.
- **`docs/m11-closeout.md` (NGX-461)** — This file.

## What was verified

Docs-only change; the smallest meaningful gates were run:

- `pnpm format:check` — pass
- `pnpm lint` — pass
- `pnpm typecheck` — pass

`pnpm test` and `pnpm smoke` were not required: no `src/`/`test/` code changed and
no README command examples or behavior claims were altered. (`prettier --check`
targets `src test` only, so the Markdown edits are outside its scope; they were
kept clean by hand.)

## Release decision

No release is required for this change. It is documentation only and uses a
`docs:` Conventional Commit, which Release Please does not treat as
release-driving. A docs-only patch release is not warranted; the next version
bump should ride real M12–M15 productionization work.

## Suggested Linear project update (post-merge)

> **Alpha closed out; productionization roadmap is live.**
>
> The Swarm alpha is feature-complete and shipped as `swarm-v0.2.0`. Every gate
> in the Release Readiness Gauntlet (M9) and Orchestrator Resolution Runtime
> (M10) is Done — including the real Codex/Claude/OpenCode/mixed-harness runs and
> the clean-clone quickstart that were previously blocked on credentials. The CLI
> runs multi-agent rounds across Claude, Codex, OpenCode, and Rovo with durable
> artifacts, deterministic synthesis, and an optional LLM orchestrator resolution
> pass.
>
> Status docs now reflect reality: `docs/release-readiness.md` is rewritten as a
> shipped-alpha report (no stale "blocked" gates), and the README is reframed as a
> completed v0.2 baseline that's ready to dogfood, with supported / reserved /
> future behavior clearly separated.
>
> Next phase is productionization, not new alpha features: **M12** public repo
> shell + release operations, **M13** docs site / spec / install guide, **M14**
> agent DX + dogfood recipes, **M15** runtime boundary refactor. Reserved surfaces
> (`--resolve agents`, the `rounds` config key, a user-facing resume command)
> remain non-contract until that work lands.
>
> No release is needed for the M11 closeout itself — it's docs-only.
