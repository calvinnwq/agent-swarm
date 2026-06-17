# Support

Agent Swarm is an alpha CLI. Support is best-effort and centered on public,
reproducible issues.

## Start Here

- Install and quickstart: [README.md](README.md)
- Development workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- Release/publish operations: [docs/release-operations.md](docs/release-operations.md)
- Current release-readiness status: [docs/release-readiness.md](docs/release-readiness.md)

## Before Opening An Issue

Run:

```bash
agent-swarm --version
agent-swarm doctor
```

If you are working from source, also run:

```bash
pnpm build
pnpm smoke
```

## Where To Ask

- Use a bug report for reproducible CLI, config, artifact, or harness dispatch
  failures.
- Use a feature request for proposed behavior changes.
- Use the README and release-readiness doc as the source of truth for the alpha
  contract. Reserved behavior is intentionally deferred until it is specified.

Do not post secrets, API keys, private prompts, customer data, or sensitive local
paths in issues or PRs.

## What Is Out Of Scope

- Private debugging of local harness accounts or auth sessions.
- Guaranteed response times.
- Support for old releases beyond the latest npm/GitHub release.
- Hosted-service operations; Agent Swarm is a local CLI.
