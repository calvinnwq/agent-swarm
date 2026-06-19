import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf-8");
}

describe("documentation contract", () => {
  it("ships the agent operation contract and links it from public docs", async () => {
    const [contract, readme, spec, skill, packageJson] = await Promise.all([
      readRepoFile("docs/agent-operation.md"),
      readRepoFile("README.md"),
      readRepoFile("SPEC.md"),
      readRepoFile(".agents/skills/agent-swarm/SKILL.md"),
      readRepoFile("package.json"),
    ]);

    expect(contract).toContain("# Agent Operation Contract");
    expect(contract).toContain("## Inputs");
    expect(contract).toContain("## Preset Selection");
    expect(contract).toContain("## Artifacts");
    expect(contract).toContain("## Reporting Format");
    expect(contract).toContain("## Structured Examples");
    expect(contract).toContain("Pass `--decision` when");
    expect(contract).toContain(".agent-swarm/runs/<timestamp>-<slug>/");
    expect(contract).toContain("No speculative control-plane implementation");

    expect(readme).toContain("docs/agent-operation.md");
    expect(spec).toContain("docs/agent-operation.md");
    expect(skill).toContain("docs/agent-operation.md");
    expect(skill).toContain("Pass `--decision` when");
    expect(JSON.parse(packageJson).files).toContain("docs/agent-operation.md");
  });

  it("ships runnable dogfood recipes for real decision work", async () => {
    const [recipes, readme, readiness, skill, operation, packageJson] =
      await Promise.all([
        readRepoFile("docs/dogfood-recipes.md"),
        readRepoFile("README.md"),
        readRepoFile("docs/release-readiness.md"),
        readRepoFile(".agents/skills/agent-swarm/SKILL.md"),
        readRepoFile("docs/agent-operation.md"),
        readRepoFile("package.json"),
      ]);

    expect(recipes).toContain("# Dogfood Recipes");
    expect(recipes).toContain("Demo Rehearsal Decision");
    expect(recipes).toContain("Linear Project Prioritization");
    expect(recipes).toContain("OpenClaw Workflow Design Review");
    expect(recipes).toContain("node ../dist/cli.mjs run 1");
    expect(recipes).toContain("--preset demo-expert-panel");
    expect(recipes).toContain("--preset demo-adversarial-review");
    expect(recipes).toContain("--doc ../docs/release-readiness.md");
    expect(recipes).toContain("--doc ../docs/agent-operation.md");
    expect(recipes).toContain("Decision Brief");
    expect(recipes).toContain("M14-04");
    expect(recipes).toContain(
      "Do not treat these as a saved-run control plane",
    );

    expect(readme).toContain("docs/dogfood-recipes.md");
    expect(readiness).toContain("dogfood-recipes.md");
    expect(skill).toContain("docs/dogfood-recipes.md");
    expect(operation).toContain("docs/dogfood-recipes.md");
    expect(JSON.parse(packageJson).files).toContain("docs/dogfood-recipes.md");
  });

  it("ships first-time agent usage guidance and the repo skill", async () => {
    const [usage, readme, spec, readiness, operation, skill, packageJson] =
      await Promise.all([
        readRepoFile("docs/agent-usage.md"),
        readRepoFile("README.md"),
        readRepoFile("SPEC.md"),
        readRepoFile("docs/release-readiness.md"),
        readRepoFile("docs/agent-operation.md"),
        readRepoFile(".agents/skills/agent-swarm/SKILL.md"),
        readRepoFile("package.json"),
      ]);

    expect(usage).toContain("# Agent Usage");
    expect(usage).toContain("product-triad");
    expect(usage).toContain("adversarial-code-review");
    expect(usage).toContain("customer-panel");
    expect(usage).toContain(".agent-swarm/config.yml");
    expect(usage).toContain("Folders are for readability only");
    expect(usage).toContain("AGENT_SWARM_SKILL_DIR");
    expect(usage).toContain("agent-swarm-helper.mjs");
    expect(usage).toContain("build-run-command");
    expect(usage).toContain("inspect-latest-run");
    expect(usage).toContain(
      "Report in the shape requested by the prompt, preset, or agent instructions",
    );
    expect(usage).toContain("No saved-run database");
    expect(usage).toContain("No new `agent-swarm templates`");

    expect(readme).toContain("docs/agent-usage.md");
    expect(readme).toContain(".agent-swarm/agents/**/*.yml");
    expect(readme).toContain("folder names are organization only");
    expect(readme).toContain(".agent-swarm/presets/**/*.yml");
    expect(operation).toContain("docs/agent-usage.md");
    expect(spec).toContain(".agent-swarm/agents/**/*.yml");
    expect(spec).toContain("organization only, not namespaces");
    expect(readiness).toContain("agent-usage.md");
    expect(readiness).toContain("### Agent Skill Maintenance");
    expect(readiness).toContain("agent-swarm-helper.mjs");
    expect(readiness).toContain(
      "pnpm test test/unit/agent-swarm-skill-helper.test.ts",
    );
    expect(skill).toContain("docs/agent-usage.md");
    expect(skill).toContain("Create Or Configure A Swarm");
    expect(skill).toContain("Subdirectories are organization only");
    expect(skill).toContain("AGENT_SWARM_SKILL_DIR");
    expect(skill).toContain("agent-swarm-helper.mjs");
    expect(skill).toContain("## Contract");
    expect(skill).toContain("## Phases");
    expect(skill).not.toContain("## Output Format");
    expect(skill).not.toContain("## Verification");

    const files = JSON.parse(packageJson).files;
    expect(files).toContain("docs/agent-usage.md");
    expect(files).toContain(".agents/skills/agent-swarm");
  });

  it("keeps human-readable docs free of maintainer personal-name references", async () => {
    const docs = await Promise.all(
      [
        "README.md",
        "CODE_OF_CONDUCT.md",
        ".agents/skills/agent-swarm/SKILL.md",
        "docs/agent-operation.md",
        "docs/agent-usage.md",
        "docs/dogfood-recipes.md",
        "docs/release-operations.md",
        "docs/release-readiness.md",
      ].map(async (file) => [file, await readRepoFile(file)] as const),
    );

    for (const [file, contents] of docs) {
      expect(contents, file).not.toMatch(/\bCalvin\b/);
    }
  });
});
