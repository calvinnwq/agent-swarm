import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const docsRoot = path.join(repoRoot, "docs");
const docsSiteUrl = "https://calvinnwq.github.io/agent-swarm/";

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf-8");
}

describe("documentation contract", () => {
  it("keeps docs/ as the public static site root", async () => {
    const entries = await readdir(docsRoot, { withFileTypes: true });
    const names = entries.map((entry) => entry.name).sort();

    expect(names).toContain("index.html");
    expect(names).toContain("assets");
    expect(names).not.toContain("site");
    expect(names).not.toContain("superpowers");

    const rootMarkdown = names.filter((name) => name.endsWith(".md"));
    expect(rootMarkdown).toEqual([]);
  });

  it("points public docs and package metadata at the shipped site and skill", async () => {
    const [readme, install, spec, skill, packageJson] = await Promise.all([
      readRepoFile("README.md"),
      readRepoFile("INSTALL.md"),
      readRepoFile("SPEC.md"),
      readRepoFile(".agents/skills/agent-swarm/SKILL.md"),
      readRepoFile("package.json"),
    ]);

    expect(readme).toContain(docsSiteUrl);
    expect(readme).toContain(`${docsSiteUrl}agent-usage.html`);
    expect(install).toContain(`${docsSiteUrl}agent-usage.html`);
    expect(spec).toContain("skills/agent-swarm");

    expect(skill).toContain("This skill is the durable operator contract");
    expect(skill).toContain(`${docsSiteUrl}agent-usage.html`);
    expect(skill).toContain("Pass `--decision` when");
    expect(skill).toContain(".agent-swarm/runs/*/synthesis.md");
    expect(skill).toContain("no scheduler, UI, saved-run database");

    const files = JSON.parse(packageJson).files;
    expect(files).toContain("docs");
    expect(files).toContain(".agents/skills/agent-swarm");
    expect(files).toContain("skills/agent-swarm");
    expect(files).not.toContain("docs/agent-operation.md");
    expect(files).not.toContain("docs/agent-usage.md");
  });

  it("does not link to retired docs markdown files", async () => {
    const docs = await Promise.all(
      [
        "README.md",
        "INSTALL.md",
        "SPEC.md",
        "CONTRIBUTING.md",
        "ARCHITECTURE.md",
        ".agents/skills/agent-swarm/SKILL.md",
        "skills/agent-swarm/SKILL.md",
        "docs/agent-usage.html",
        "docs/release-readiness.html",
      ].map(async (file) => [file, await readRepoFile(file)] as const),
    );

    for (const [file, contents] of docs) {
      expect(contents, file).not.toContain("docs/agent-operation.md");
      expect(contents, file).not.toContain("docs/agent-usage.md");
      expect(contents, file).not.toContain("docs/dogfood-recipes.md");
      expect(contents, file).not.toContain("docs/release-operations.md");
      expect(contents, file).not.toContain("docs/release-readiness.md");
      expect(contents, file).not.toContain("docs/m11-closeout.md");
      expect(contents, file).not.toContain("docs/m15-closeout.md");
    }
  });

  it("keeps human-readable docs free of maintainer personal-name references", async () => {
    const docs = await Promise.all(
      [
        "README.md",
        "CODE_OF_CONDUCT.md",
        ".agents/skills/agent-swarm/SKILL.md",
        "docs/index.html",
        "docs/agent-usage.html",
        "docs/release-readiness.html",
      ].map(async (file) => [file, await readRepoFile(file)] as const),
    );

    for (const [file, contents] of docs) {
      expect(contents, file).not.toMatch(/\bCalvin\b/);
    }
  });
});
