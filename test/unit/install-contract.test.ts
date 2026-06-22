import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf-8");
}

describe("INSTALL agent-operated setup contract", () => {
  it("leads with the skill-first install path using the GitHub owner/repo form", async () => {
    const install = await readRepoFile("INSTALL.md");

    // The skills CLI resolves an `owner/repo` GitHub source, not an npm
    // package name, so the install command must use `calvinnwq/agent-swarm`.
    expect(install).toContain(
      "npx skills add calvinnwq/agent-swarm --skill agent-swarm",
    );
    expect(install).not.toContain("skills add @calvinnwq/agent-swarm");
  });

  it("documents the one-line instruction to the coding agent", async () => {
    const install = await readRepoFile("INSTALL.md");
    expect(install).toContain("Use the agent-swarm skill");
  });

  it("shows the skill runs the CLI via npx with no global install required", async () => {
    const install = await readRepoFile("INSTALL.md");
    expect(install).toContain("npx -y @calvinnwq/agent-swarm");
  });

  it("renders installed-skill run commands through npx", async () => {
    const helper = await import(
      path.join(
        repoRoot,
        ".agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs",
      )
    );

    expect(
      helper.buildRunCommand({
        question: "Should we launch?",
        preset: "product-triad",
      }).argv,
    ).toEqual(expect.arrayContaining(["npx", "-y", "@calvinnwq/agent-swarm"]));
  });

  it("keeps source-checkout built CLI override available", async () => {
    const helper = await import(
      path.join(
        repoRoot,
        ".agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs",
      )
    );

    expect(
      helper
        .buildRunCommand({
          question: "Should we launch?",
          preset: "product-triad",
          builtCli: true,
        })
        .argv.slice(0, 2),
    ).toEqual(["node", "../dist/cli.mjs"]);
  });

  it("renders global CLI fallback commands when requested", async () => {
    const helper = await import(
      path.join(
        repoRoot,
        ".agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs",
      )
    );

    expect(
      helper
        .buildRunCommand({
          question: "Should we launch?",
          preset: "product-triad",
          globalCli: true,
        })
        .argv.slice(0, 1),
    ).toEqual(["agent-swarm"]);
  });

  it("keeps the global install optional for repeat use and performance", async () => {
    const install = await readRepoFile("INSTALL.md");
    expect(install).toContain("npm install -g @calvinnwq/agent-swarm");
    expect(install).toMatch(/optional/i);
    expect(install).toMatch(/repeat use|performance/i);
  });

  it("explains the root config defaults and when custom files are created", async () => {
    const install = await readRepoFile("INSTALL.md");
    expect(install).toContain(".agent-swarm/config.yml");
    expect(install).toContain("agent-swarm init");
    expect(install).toContain("product-triad");
    expect(install).toContain("timeoutMs: 300000");
    expect(install).toContain(".agent-swarm/agents/");
    expect(install).toContain(".agent-swarm/presets/");
  });

  it("keeps coding-agent examples generic", async () => {
    const install = await readRepoFile("INSTALL.md");
    expect(install).toContain("Codex");
    expect(install).toContain("Claude");
    expect(install).toContain("OpenClaw");
  });

  it("states the runtime non-goals", async () => {
    const install = await readRepoFile("INSTALL.md");
    expect(install).toContain("## Non-Goals");
    expect(install).toContain("No scheduler");
    expect(install).toContain("No saved-run database");
    expect(install).toContain("No hosted control plane");
    expect(install).toContain("No UI");
  });

  it("points to INSTALL for agent-operated setup from the README", async () => {
    const readme = await readRepoFile("README.md");
    expect(readme).toContain("INSTALL.md");
    expect(readme).toMatch(/agent-operated setup/i);
    expect(readme).toContain(
      "npx skills add calvinnwq/agent-swarm --skill agent-swarm",
    );
  });

  it("uses the GitHub owner/repo skills source consistently across docs", async () => {
    const docs = await Promise.all(
      ["README.md", "INSTALL.md", "docs/quickstart.html"].map(
        async (file) => [file, await readRepoFile(file)] as const,
      ),
    );
    for (const [file, contents] of docs) {
      expect(contents, file).not.toContain("skills add @calvinnwq/agent-swarm");
      expect(contents, file).toContain(
        "skills add calvinnwq/agent-swarm --skill agent-swarm",
      );
    }
  });
});
