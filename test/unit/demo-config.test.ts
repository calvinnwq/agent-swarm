import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentRegistry, loadPresetRegistry } from "../../src/lib/index.js";

const demoDir = fileURLToPath(new URL("../../demo", import.meta.url));
const repoRoot = path.dirname(demoDir);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempHomeDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-swarm-demo-home-"));
  tempDirs.push(dir);
  return dir;
}

describe("demo config", () => {
  it("ships a repo-discoverable generic Agent Swarm skill", async () => {
    const skill = await readFile(
      path.join(repoRoot, ".agents", "skills", "agent-swarm", "SKILL.md"),
      "utf-8",
    );

    expect(skill).toContain("name: agent-swarm");
    expect(skill).toContain("Run and inspect Agent Swarm CLI panels");
    expect(skill).toContain("demo-expert-panel");
  });

  it("loads the contained demo agents and presets from demo/.agent-swarm", async () => {
    const homeDir = await tempHomeDir();
    const agents = await loadAgentRegistry({
      cwd: demoDir,
      homeDir,
      bundledDir: path.join(repoRoot, "src", "agents", "bundled"),
    });
    const presets = await loadPresetRegistry({
      cwd: demoDir,
      homeDir,
      bundledDir: path.join(repoRoot, "src", "presets", "bundled"),
    });

    expect(agents.getAgent("pm-codex")).toMatchObject({
      harness: "codex",
      model: "gpt-5.5",
    });
    expect(agents.getAgent("engineer-codex")).toMatchObject({
      harness: "codex",
      model: "gpt-5.3-codex-spark",
    });
    expect(agents.getAgent("designer-claude")).toMatchObject({
      harness: "claude",
      model: "claude-opus-4-8",
    });
    expect(agents.getAgent("implementer-opencode")).toMatchObject({
      harness: "opencode",
      model: "openai/gpt-5.5",
    });

    expect(presets.getPreset("demo-expert-panel")).toMatchObject({
      agents: ["pm-codex", "engineer-codex", "designer-claude"],
      resolve: "off",
    });
    expect(presets.getPreset("demo-adversarial-review")).toMatchObject({
      agents: ["advocate-codex", "skeptic-codex", "implementer-opencode"],
      resolve: "off",
    });
    expect(presets.getPreset("demo-customer-panel")).toMatchObject({
      agents: [
        "new-user-codex",
        "busy-operator-codex",
        "skeptical-buyer-codex",
      ],
      resolve: "off",
    });

    for (const preset of [
      "demo-expert-panel",
      "demo-adversarial-review",
      "demo-customer-panel",
    ]) {
      for (const agentName of presets.getPreset(preset).agents) {
        expect(agents.getAgent(agentName).name).toBe(agentName);
      }
    }
  });

  it("keeps the copy-paste prompts wired to the repo Agent Swarm skill", async () => {
    for (const promptName of [
      "expert-panel.md",
      "adversarial-review.md",
      "customer-panel.md",
    ]) {
      const prompt = await readFile(
        path.join(demoDir, "prompts", promptName),
        "utf-8",
      );
      expect(prompt).toContain("$agent-swarm");
      expect(prompt).toContain("one round");
      expect(prompt).toContain("10 minute timeout");
    }
  });
});
