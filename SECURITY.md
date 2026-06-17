# Security Policy

Agent Swarm is an alpha CLI that shells out to local harness tools such as
Claude, Codex, and OpenCode. It does not run a hosted service and does not
collect credentials, but it can process local prompts, docs, config, and run
artifacts. Treat those files as potentially sensitive.

## Supported Versions

Security fixes target the latest public npm/GitHub release only.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |

## Reporting A Vulnerability

Do not open a public issue with exploit details, private prompts, tokens,
customer data, or local paths.

Preferred reporting path:

1. Use GitHub's private vulnerability reporting for this repository if it is
   available.
2. If private vulnerability reporting is not available, contact the maintainer
   through an existing private channel and share only enough public context to
   establish that a security report exists.

Please include:

- Affected Agent Swarm version or commit.
- Operating system and Node version.
- The command or workflow involved.
- Whether the issue affects bundled agents/presets, custom local definitions,
  config loading, run artifacts, or harness dispatch.
- Minimal reproduction steps with secrets and private data removed.

## What Counts As Security-sensitive

Examples worth reporting privately:

- Accidental publication of secrets or private local files in package contents,
  logs, artifacts, or diagnostics.
- Unsafe handling of `.agent-swarm/` or legacy `.swarm/` paths that could read
  or write outside the intended project/user roots.
- Command construction bugs that could allow shell injection.
- Vulnerabilities in package, release, or install flows.
- Bugs that expose private prompts, carry-forward docs, or run artifacts.

General bugs, harness auth setup, prompt quality, and expected alpha limitations
belong in normal GitHub issues.

## Maintainer Expectations

The maintainer will triage credible reports, avoid public disclosure before a
fix is available, and credit reporters when appropriate. There is no paid bounty
program or guaranteed response SLA.
