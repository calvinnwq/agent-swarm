# Agent Swarm — Installation & Setup

This guide is about making your **coding agent** Agent-Swarm-capable, not just
installing a CLI for a human to type. The primary path is skill-first: install
the `agent-swarm` skill into your agent, then ask the agent in plain language to
run a panel. A global CLI install is optional.

For the full user contract see the [README](README.md) and [SPEC.md](SPEC.md);
for development setup see [CONTRIBUTING.md](CONTRIBUTING.md). The npm package is
scoped as `@calvinnwq/agent-swarm`; the executable bin is `agent-swarm`.

> **Never paste secrets.** Do not put API keys, tokens, private prompts,
> customer data, or sensitive local paths into issues, PRs, release notes, or
> logs. Harness authentication is handled by each harness CLI's own login
> command — Agent Swarm never asks you to paste a token.

---

## 1. Make your coding agent Agent-Swarm-capable (start here)

This is the supported public-adoption path. It works with any agent that follows
the common skills-installer convention — **Codex, Claude Code, OpenClaw, and
others are examples only**; the flow is agent-agnostic and needs no global CLI
install.

### 1.1 Install the skill

```bash
npx skills add calvinnwq/agent-swarm --skill agent-swarm
```

`skills add` resolves a GitHub `owner/repo` source (not an npm package name), so
the source is `calvinnwq/agent-swarm` — the repository — and `--skill
agent-swarm` selects the one skill to install. This copies the published
`skills/agent-swarm` directory into your agent's local skills directory.

From a source checkout, copy the same directory directly instead:

```bash
cp -R skills/agent-swarm /path/to/agent/skills/agent-swarm
```

### 1.2 Tell your agent what to do (one line)

Once the skill is installed, drive everything in natural language. A single
instruction is enough:

> "Use the agent-swarm skill to run the product-triad panel on whether we should
> adopt server components, and summarize the recommendation."

The skill translates that intent into the right `.agent-swarm/` config and the
correct CLI invocation — you do not hand it flags. It chooses the project
directory, preset, goal, decision matrix, docs, resolve mode, and timeout, runs
the swarm, then reports the recommendation, tradeoff, risks, and run path.

### 1.3 How the skill runs the CLI (no global install required)

The skill's preflight and run steps call the `agent-swarm` CLI. You do **not**
need a global install: run those commands on demand with npx, which fetches and
executes the published package:

```bash
npx -y @calvinnwq/agent-swarm doctor
npx -y @calvinnwq/agent-swarm run 1 "<question>" --preset product-triad
```

`npx -y @calvinnwq/agent-swarm` runs the scoped package's `agent-swarm` bin; the
`-y` flag auto-confirms the one-time package download. If your environment can't
resolve the bin through npx, install globally (§4) and ask the skill to use the
global CLI fallback.

---

## 2. Prerequisites

- **Node ≥ 20** (Node 24 LTS recommended — `.nvmrc` pins it; run `nvm use` in a
  source checkout). `npx` ships with Node, so the skill-first path needs nothing
  else installed up front.
- **A harness CLI on `PATH`, authenticated.** Agent Swarm shells out to a
  harness CLI to run each agent. You only need the harness your chosen
  preset/agents resolve to. Examples:
  - **Claude** (default) — `claude`, logged in with `claude auth login`.
  - **Codex** — `codex`, logged in with `codex login`, new enough for
    `codex exec`.
  - **OpenCode** — `opencode`, logged in with `opencode auth login`.
  - **Rovo** — `acli` with the `rovodev` plugin runnable.
- **pnpm 10** — only for source installs and development.

The bundled `product-triad` / `product-decision` presets use Claude; the
`-codex` and `-opencode` preset variants use Codex and OpenCode respectively.

---

## 3. Project defaults: `.agent-swarm/config.yml`

Agent Swarm reads project defaults from `.agent-swarm/config.yml`. You don't need
one to run a bundled preset, but it lets a project pin its own defaults.

Drop a minimal config with `npx -y @calvinnwq/agent-swarm init` (or
`agent-swarm init` when using a global/source CLI):

```bash
npx -y @calvinnwq/agent-swarm init            # creates the config; leaves an existing one alone
npx -y @calvinnwq/agent-swarm init --force    # overwrite an existing/broken config with defaults
```

It writes only `.agent-swarm/config.yml` with safe defaults and never touches
agents, presets, or the legacy `.swarm/` path:

```yaml
preset: product-triad
resolve: off
timeoutMs: 300000
```

Precedence is always **CLI flags > config values > preset defaults**, so a
config never hides what a flag sets. See [SPEC.md](SPEC.md) §3.

### When custom presets and agents are created

The bundled presets (`product-triad`, `adversarial-code-review`,
`customer-panel`) cover most first runs, so start there. Create project-local
files under `.agent-swarm/agents/` and `.agent-swarm/presets/` **only when you
ask for a custom swarm** — for example a project-specific review panel. The skill
creates them on request; you rarely author them by hand. Subdirectories under
those folders are for readability only — the YAML `name` is the canonical
identity. First-time agent setup details live in
[docs/agent-usage.md](docs/agent-usage.md).

---

## 4. Optional: global install (for repeat use and performance)

A global install is **optional**. Prefer it for repeat use or when `npx`'s
per-call package resolution is too slow — a resolved global bin starts faster
than fetching through npx on every call.

```bash
npm install -g @calvinnwq/agent-swarm
```

This exposes the `agent-swarm` command on your `PATH`. When using the skill
helper in this mode, add `--global-cli` so generated commands start with
`agent-swarm` instead of `npx -y @calvinnwq/agent-swarm`. (`npm install --global
…` is the same thing.)

### Source install

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

## 5. Verify your setup

```bash
npx -y @calvinnwq/agent-swarm --version
npx -y @calvinnwq/agent-swarm doctor
# or, with a global/source install: agent-swarm --version && agent-swarm doctor
```

`agent-swarm doctor` validates project config, configured docs, the agent/preset
registries, backend compatibility, and (when a project config is present) probes
the resolved harness CLIs for auth. Exit codes:

- `0` — everything is ready.
- `1` — at least one check failed (with actionable per-check messages).
- `2` — internal command error.

Without a project config, doctor skips harness-capability checks — so a clean
`doctor` with no config does not by itself prove your harness is authenticated.
Run a first panel (below) to confirm end-to-end.

---

## 6. First run

You can let the skill drive (§1.2), or run the CLI directly. The supported alpha
flow uses a bundled preset (Claude); no config required:

```bash
npx -y @calvinnwq/agent-swarm run 1 "Should we adopt server components?" \
  --preset product-triad \
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
- For Codex or OpenCode, use a `-codex` / `-opencode` preset variant and the
  matching authenticated harness.

---

## 7. Common failures

| Symptom                                      | Likely cause / fix                                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx skills add` does nothing / wrong source | Use the GitHub `owner/repo` form `calvinnwq/agent-swarm`, not the npm name `@calvinnwq/agent-swarm` — `skills add` resolves a repo, not an npm package.                    |
| `agent-swarm: command not found`             | No global/source install on `PATH`. Use `npx -y @calvinnwq/agent-swarm …`, or install globally (§4). For source installs, complete the one-time `pnpm setup` (§4).         |
| `npx` can't resolve the bin                  | Known scoped-package bin-link caveat in some environments — install globally (§4), then use the skill helper's `--global-cli` fallback.                                    |
| doctor reports a harness probe failure       | The harness CLI is missing or unauthenticated. Log in (`claude auth login`, `codex login`, `opencode auth login`) or install `acli` + `rovodev`.                           |
| Run fails with a timeout                     | Increase `--timeout-ms` (default 120000); real harnesses are slower than stubs.                                                                                            |
| Run fails after an orchestrator pass         | `--resolve orchestrator` requires a working harness for the bundled `orchestrator`. The run finalizes as `failed` and exits `1`; earlier passes stay in `checkpoint.json`. |
| Config changes seem ignored                  | Precedence is CLI flags > config > preset. Check for a flag overriding your config value.                                                                                  |
| doctor mentions a legacy `.swarm/config.yml` | Config is being read from the legacy path — migrate to `.agent-swarm/` (§8).                                                                                               |
| Unknown-key / type error in config           | `.agent-swarm/config.yml` is strict. Use only the supported keys (see [SPEC.md](SPEC.md) §3), or recover with `agent-swarm init --force`.                                  |

When reporting an issue, run `agent-swarm --version` and `agent-swarm doctor`
first (and `pnpm build && pnpm smoke` from source), and include the output —
**without** secrets, tokens, private prompts, or sensitive paths. See
[SUPPORT.md](SUPPORT.md).

---

## 8. Legacy `.swarm/` migration

Agent Swarm was previously published as `swarm` and stored data under `.swarm/`.
It now stores project/user data under `.agent-swarm/`. For at least one release
the legacy `.swarm/` locations — project config, agents, presets — are still
read as a fallback, with the new `.agent-swarm/` path winning when both exist.
New run artifacts are always written under `.agent-swarm/runs/`.

If the new directory does not exist yet, you can rename the legacy directory:

```bash
# project scope
mv .swarm .agent-swarm

# user scope
mv ~/.swarm ~/.agent-swarm
```

If `.agent-swarm/` already exists, do not run `mv .swarm .agent-swarm`: it
will place the legacy directory inside the new one instead of merging the data.
Copy only the files you still need into the matching `.agent-swarm/` paths, and
keep the new-path files when both versions exist.

`agent-swarm doctor` flags when config is read from the legacy path so you know
migration is pending.

---

## 9. Update and uninstall

```bash
# Update a global install
npm install -g @calvinnwq/agent-swarm@latest

# Uninstall a global install
npm uninstall -g @calvinnwq/agent-swarm

# Source install: refresh the build, or unlink the local package
pnpm install && pnpm build
pnpm unlink                                      # or: npm unlink
```

The skill-first path needs no update step — `npx -y @calvinnwq/agent-swarm`
fetches the published version on demand. Run artifacts under `.agent-swarm/runs/`
are plain files; remove them manually if you no longer need them.

---

## Non-Goals

This guide installs a skill and an optional CLI. It does **not** add a new
runtime surface, and neither does the skill:

- No scheduler.
- No UI.
- No saved-run database.
- No hosted control plane.
- No command surface beyond `run`, `doctor`, and the minimal `init` helper.

`agent-swarm init` is only a tiny helper that writes the minimal
`.agent-swarm/config.yml`; it is not a wizard and never installs packages,
skills, agents, or presets.
