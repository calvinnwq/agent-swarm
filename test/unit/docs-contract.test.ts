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
    expect(contract).toContain("Do not pass `--decision`");
    expect(contract).toContain(".agent-swarm/runs/<timestamp>-<slug>/");
    expect(contract).toContain("No speculative control-plane implementation");

    expect(readme).toContain("docs/agent-operation.md");
    expect(spec).toContain("docs/agent-operation.md");
    expect(skill).toContain("docs/agent-operation.md");
    expect(JSON.parse(packageJson).files).toContain("docs/agent-operation.md");
  });
});
