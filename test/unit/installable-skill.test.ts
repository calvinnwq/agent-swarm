import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceSkillDir = path.join(repoRoot, ".agents", "skills", "agent-swarm");
const publicSkillDir = path.join(repoRoot, "skills", "agent-swarm");

async function listFilesRecursively(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else {
        found.push(path.relative(root, absolute));
      }
    }
  }
  await walk(root);
  return found.sort();
}

describe("public installable skill", () => {
  it("mirrors the repo-agent skill into the public skills/ path without drift", async () => {
    const [sourceFiles, publicFiles] = await Promise.all([
      listFilesRecursively(sourceSkillDir),
      listFilesRecursively(publicSkillDir),
    ]);

    expect(publicFiles).toEqual(sourceFiles);

    for (const relativePath of sourceFiles) {
      const [sourceContents, publicContents] = await Promise.all([
        readFile(path.join(sourceSkillDir, relativePath), "utf-8"),
        readFile(path.join(publicSkillDir, relativePath), "utf-8"),
      ]);
      expect(publicContents, `public skill drift in ${relativePath}`).toBe(
        sourceContents,
      );
    }
  });

  it("ships the public installable skill directory in the npm package", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(repoRoot, "package.json"), "utf-8"),
    );
    expect(packageJson.files).toContain("skills/agent-swarm");
  });

  it("links package-root docs from the installed skill via public URLs", async () => {
    const skill = await readFile(
      path.join(publicSkillDir, "SKILL.md"),
      "utf-8",
    );
    const docs = [
      "docs/agent-operation.md",
      "docs/agent-usage.md",
      "docs/dogfood-recipes.md",
    ];

    for (const doc of docs) {
      expect(skill).toContain(
        `https://github.com/calvinnwq/agent-swarm/blob/main/${doc}`,
      );
    }
    expect(skill).not.toContain("see `docs/agent-operation.md`");
    expect(skill).not.toContain("see `docs/agent-usage.md`");
    expect(skill).not.toContain("see `docs/dogfood-recipes.md`");
  });

  it("documents the generic skills install path agnostically", async () => {
    const usage = await readFile(
      path.join(repoRoot, "docs", "agent-usage.md"),
      "utf-8",
    );
    expect(usage).toContain("npx skills add");
    expect(usage).toContain("--skill agent-swarm");
    expect(usage).toContain("skills/agent-swarm");
  });
});
