# Agent Swarm — Installation & Setup

This guide covers installing Agent Swarm, the prerequisites, verifying your
setup, your first run, and common failure modes. For the full user contract see
the [README](README.md) and [SPEC.md](SPEC.md); for development setup see
[CONTRIBUTING.md](CONTRIBUTING.md).

The npm package is scoped as `@calvinnwq/agent-swarm`; the installed executable
is `agent-swarm`.

> **Never paste secrets.** Do not put API keys, tokens, private prompts,
> customer data, or sensitive local paths into issues, PRs, release notes, or
> logs. Harness authentication is handled by each harness CLI's own login
> command — Agent Swarm never asks you to paste a token.

---

## 1. Prerequisites

- **Node ≥ 20** (Node 24 LTS recommended — `.nvmrc` pins it; run `nvm use` in a
  source checkout).
- **pnpm 10** (for source installs and development).
- **A harness CLI on `PATH`, authenticated.** At least one of:
  - **Claude** (default) — `claude`, logged in with `claude auth login`.
  - **Codex** — `codex`, logged in with `codex login`, new enough for
    `codex exec`.
  - **OpenCode** — `opencode`, logged in with `opencode auth login`.
  - **Rovo** — `acli` with the `rovodev` plugin runnable.

The bundled `product-decision` preset uses Claude; the `-codex` and `-opencode`
preset variants use Codex and OpenCode respectively. You only need the harness
your chosen preset/agents resolve to.

---

## 2. Install

### 2.1 Global npm install (recommended)

```bash
npm install --global @calvinnwq/agent-swarm
```

This exposes the `agent-swarm` command on your `PATH`.

> **`npx` / `npm exec` caveat.** A known bin-link issue can affect
> `npx`/`npm exec` invocations — prefer a global install for the CLI. See
> [docs/release-operations.md](docs/release-operations.md) for details.

### 2.2 Source install

```bash
pnpm install
pnpm build
pnpm link --global   # exposes the agent-swarm bin from dist/cli.mjs
```

**First-time `pnpm link --global`:** pnpm's global bin directory must be
configured once. Run `pnpm setup`, open a new shell (or `source ~/.zshrc` /
`source ~/.bashrc`), then re-run `pnpm link --global`. This is a one-time pnpm
step, not Agent Swarm-specific — see the [pnpm docs](https://pnpm.io/cli/setup).
If you'd rather skip global pnpm config, `npm link` works fine against the
pnpm-installed dep tree.

Don't edit anything under `dist/` by hand; always rebuild with `pnpm build`.

---

## 3. Verify your setup

```bash
agent-swarm --version
agent-swarm doctor
```

`agent-swarm doctor` validates project config, configured docs, the agent/preset
registries, backend compatibility, and (when a project config is present) probes
the resolved harness CLIs for auth. Exit codes:

- `0` — everything is ready.
- `1` — at least one check failed (with actionable per-check messages).
- `2` — internal command error.

Without a project config, doctor skips harness-capability checks — so a clean
`doctor` with no config does not by itself prove your harness is authenticated.
Run a quickstart (below) to confirm end-to-end.

---

## 4. First run

The supported alpha flow uses the bundled `product-decision` preset (Claude). No
config required:

```bash
agent-swarm run 1 "Should we adopt server components?" \
  --preset product-decision \
  --goal "Decide on migration strategy" \
  --decision "Adopt / Defer / Reject" \
  --timeout-ms 300000
```

When it finishes you'll find a self-contained run directory under
`.agent-swarm/runs/<timestamp>-<slug>/` with a deterministic `synthesis.md`.

Notes:

- Real harnesses can exceed the default 120s timeout — bump `--timeout-ms` for
  deeper runs.
- Use `--quiet` for one-line-per-event output (useful in CI/non-TTY).
- For Codex or OpenCode, use `--preset product-decision-codex` or
  `--preset product-decision-opencode` and the matching authenticated harness.

---

## 5. Common failures

| Symptom                                       | Likely cause / fix                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `agent-swarm: command not found`              | Global bin not on `PATH`. For source installs, complete the one-time `pnpm setup` (§2.2).            |
| `npx`/`npm exec` can't find the bin            | Known bin-link caveat — install globally instead.                                                   |
| doctor reports a harness probe failure         | The harness CLI is missing or unauthenticated. Log in (`claude auth login`, `codex login`, `opencode auth login`) or install `acli` + `rovodev`. |
| Run fails with a timeout                        | Increase `--timeout-ms` (default 120000); real harnesses are slower than stubs.                     |
| Run fails after an orchestrator pass            | `--resolve orchestrator` requires a working harness for the bundled `orchestrator`. The run finalizes as `failed` and exits `1`; earlier passes stay in `checkpoint.json`. |
| Config changes seem ignored                     | Precedence is CLI flags > config > preset. Check for a flag overriding your config value.            |
| doctor mentions a legacy `.swarm/config.yml`    | Config is being read from the legacy path — migrate to `.agent-swarm/` (§6).                         |
| Unknown-key / type error in config              | `.agent-swarm/config.yml` is strict. Use only the supported keys (see [SPEC.md](SPEC.md) §3).        |

When reporting an issue, run `agent-swarm --version` and `agent-swarm doctor`
first (and `pnpm build && pnpm smoke` from source), and include the output —
**without** secrets, tokens, private prompts, or sensitive paths. See
[SUPPORT.md](SUPPORT.md).

---

## 6. Legacy `.swarm/` migration

Agent Swarm was previously published as `swarm` and stored data under `.swarm/`.
It now stores project/user data under `.agent-swarm/`. For at least one release
the legacy `.swarm/` locations — project config, agents, presets — are still
read as a fallback, with the new `.agent-swarm/` path winning when both exist.
New run artifacts are always written under `.agent-swarm/runs/`.

To migrate, move your legacy directory:

```bash
# project scope
mv .swarm .agent-swarm

# user scope
mv ~/.swarm ~/.agent-swarm
```

`agent-swarm doctor` flags when config is read from the legacy path so you know
migration is pending.

---

## 7. Update and uninstall

```bash
# Update (global npm install)
npm install --global @calvinnwq/agent-swarm@latest

# Uninstall (global npm install)
npm uninstall --global @calvinnwq/agent-swarm

# Source install: refresh the build, or unlink
pnpm install && pnpm build
pnpm uninstall --global @calvinnwq/agent-swarm   # or: npm unlink
```

Run artifacts under `.agent-swarm/runs/` are plain files; remove them manually
if you no longer need them.
