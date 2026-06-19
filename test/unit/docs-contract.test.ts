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

  it("keeps human-readable docs free of maintainer personal-name references", async () => {
    const docs = await Promise.all(
      [
        "README.md",
        "CODE_OF_CONDUCT.md",
        ".agents/skills/agent-swarm/SKILL.md",
        "docs/agent-operation.md",
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
