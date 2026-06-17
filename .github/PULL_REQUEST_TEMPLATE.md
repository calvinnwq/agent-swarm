## Summary

## Surface

- [ ] CLI/help/error output
- [ ] Runtime behavior or synthesis
- [ ] Agents, presets, or harness dispatch
- [ ] Config, storage, artifacts, or resume
- [ ] Docs, templates, or release metadata only

## Agent Swarm Boundaries

- [ ] README/SPEC updated if user-facing alpha behavior changed
- [ ] `.agent-swarm/` writes and legacy `.swarm/` read fallback are preserved, or not touched
- [ ] Harness-specific behavior stays behind the harness adapter boundary, or not touched
- [ ] Durable artifacts remain append-only/resumable where applicable, or not touched
- [ ] Release/npm impact is called out, or this is non-release work

## Verification

- [ ] `git diff --check`
- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm smoke`
- [ ] `pnpm test:e2e` if CLI/runtime behavior changed
- [ ] `pnpm smoke:real` only if real harness behavior changed
