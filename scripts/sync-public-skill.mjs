#!/usr/bin/env node
// Mirror the canonical repo-agent skill into the public installable skill path.
//
// Source of truth: .agents/skills/agent-swarm (used by repo agents and the
// docs/test contract). Public mirror: skills/agent-swarm (the directory shipped
// in the npm package and consumed by the generic `npx skills add` flow).
//
// Run `pnpm skills:sync` after editing the source skill, then commit both
// copies. The test/unit/installable-skill.test.ts drift check fails the build
// if the two copies diverge.
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(repoRoot, ".agents", "skills", "agent-swarm");
const dest = path.join(repoRoot, "skills", "agent-swarm");

rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });

console.log(`Synced public skill: ${path.relative(repoRoot, source)} -> ${path.relative(repoRoot, dest)}`);
