# Release Operations

This is the operator runbook for Agent Swarm releases and npm publication.

Agent Swarm has two separate release surfaces:

- **GitHub release:** automated by Release Please from Conventional Commits on `main`.
- **npm package:** published manually for now as `@calvinnwq/agent-swarm`; the executable bin remains `agent-swarm`.

Do not publish to npm, create/delete/move tags, edit GitHub releases, change package access, or configure npm trusted publishing without explicit approval.

## Current Policy

- Package: `@calvinnwq/agent-swarm`
- CLI bin: `agent-swarm`
- GitHub repository: `calvinnwq/agent-swarm`
- GitHub tag format: plain `vX.Y.Z`
- GitHub release title format: plain `vX.Y.Z`
- Release automation: Release Please, manifest mode
- npm automation: none yet; manual publish only

Release Please is configured by `release-please-config.json` and `.release-please-manifest.json`. The single package entry uses `include-component-in-tag: false`, `include-v-in-tag: true`, and `include-v-in-release-name: true`, so a release PR should produce a plain tag and release title such as `v0.3.2`.

The historical pre-npm releases were retagged to plain `vX.Y.Z` during the Agent Swarm rename. Do not recreate `swarm-vX.Y.Z` or `agent-swarm-vX.Y.Z` tags.

## Release-driving Changes

Use Conventional Commits on `main`:

- `feat:`, `fix:`, and `deps:` drive a Release Please release.
- `docs:`, `test:`, `refactor:`, `chore:`, and project-specific non-release scopes usually do not.

Before merging a release-driving PR, confirm the change should ship in the next npm package. If a release-driving type is accidental, amend the commit or PR before merge.

## Before Merging The Release Please PR

When Release Please opens or updates a PR:

1. Confirm the PR only changes expected release files: `package.json`, `.release-please-manifest.json`, and `CHANGELOG.md`.
2. Confirm the version is correct and the changelog entries match the release-driving commits.
3. Confirm the expected tag/release format is plain `vX.Y.Z`, not component-prefixed.
4. Wait for CI to pass.
5. Merge the Release Please PR normally.

After merge, verify:

```bash
gh release view vX.Y.Z
git fetch --tags
git tag --list 'v*' --sort=-v:refname | head
```

Release Please creates the git tag and GitHub Release. It does **not** publish the npm package.

## Manual npm Publish

Only publish after the Release Please PR has merged and the GitHub release/tag exists.

Prepare and inspect the package:

```bash
git status --short --branch
pnpm install --frozen-lockfile
pnpm build
npm publish --dry-run --json
```

Inspect the dry-run output for:

- package name `@calvinnwq/agent-swarm`
- version matching `package.json`
- bin entry `agent-swarm -> dist/cli.mjs`
- expected files only: `dist/`, `LICENSE`, `README.md`, and `package.json`
- no local workflow state, temp files, tests, or private agent artifacts

Publish only after explicit approval:

```bash
npm whoami
npm publish --access public
```

The package is scoped, so `--access public` is required for public publication.

Do not document or paste one-time passwords, recovery codes, npm tokens, or browser authentication details in chat, commits, PRs, or issue comments.

## Registry Verification

After publish, registry propagation can lag briefly. Verify until the public registry is coherent:

```bash
npm view @calvinnwq/agent-swarm version dist-tags bin --json
npm pack @calvinnwq/agent-swarm@X.Y.Z --dry-run --json
```

Then run a temp install smoke outside the repo:

```bash
tmpdir="$(mktemp -d)"
npm install --prefix "$tmpdir" @calvinnwq/agent-swarm@X.Y.Z
"$tmpdir/node_modules/.bin/agent-swarm" --version
"$tmpdir/node_modules/.bin/agent-swarm" --help
command -v trash >/dev/null && trash "$tmpdir"
```

The documented install path is:

```bash
npm install --global @calvinnwq/agent-swarm
agent-swarm --version
```

During the first scoped publish, `npm exec --package @calvinnwq/agent-swarm@0.3.2 -- agent-swarm` and equivalent `npx` calls did not reliably link the bin during verification, while global/local install did. Treat `npm exec`/`npx` as optional extra checks until they are re-proven.

## Manual Real-harness Gate

CI uses stubbed harnesses. Before a release that changes harness dispatch, bundled agents/presets, artifact semantics, or CLI run behavior, also run:

```bash
pnpm smoke:real --harness claude --topic "release readiness check"
pnpm smoke:real --harness codex --topic "release readiness check"
pnpm smoke:real --harness opencode --topic "release readiness check"
pnpm smoke:real --harness claude,codex --topic "release readiness check"
```

These runs require local harness binaries and auth. They are manual release evidence, not CI.

## Future Automation

npm Trusted Publishing/OIDC is the preferred future direction if npm publishing becomes automated. That should be a separate approved issue because it changes package-release authority. Do not add long-lived `NPM_TOKEN` publishing unless Calvin explicitly chooses that path.

## References

- Release Please action: <https://github.com/googleapis/release-please-action>
- npm publish command: <https://docs.npmjs.com/cli/v11/commands/npm-publish/>
- npm scoped public packages: <https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/>
- npm Trusted Publishing: <https://docs.npmjs.com/trusted-publishers/>
