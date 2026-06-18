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
    expect(skill).toContain("Natural prompts are expected");
    expect(skill).toContain("Natural Prompt Workflow");
    expect(skill).toContain(
      "expert panel -> product, engineering, and design review presets",
    );
    expect(skill).toContain("Pass `--decision` when");
    expect(skill).not.toContain("Demo Presets");
    expect(skill).not.toContain("demo-expert-panel");
    expect(skill).not.toContain("demo-adversarial-review");
    expect(skill).not.toContain("demo-customer-panel");
    expect(skill).not.toContain("meetup demo");
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

    expect(agents.getAgent("product-manager")).toMatchObject({
      harness: "codex",
      model: "gpt-5.5",
    });
    expect(agents.getAgent("principal-engineer")).toMatchObject({
      harness: "codex",
      model: "gpt-5.3-codex-spark",
    });
    expect(agents.getAgent("product-designer")).toMatchObject({
      harness: "claude",
      model: "claude-opus-4-8",
    });
    expect(agents.getAgent("implementer")).toMatchObject({
      harness: "opencode",
      model: "openai/gpt-5.5",
    });

    expect(presets.getPreset("demo-expert-panel")).toMatchObject({
      description:
        "One-round product, engineering, and design panel for choosing the next highest-leverage improvement.",
      agents: ["product-manager", "principal-engineer", "product-designer"],
      resolve: "off",
      decision: "Build now / Defer / Reject",
    });
    expect(presets.getPreset("demo-expert-panel").goal).toBeUndefined();
    expect(presets.getPreset("demo-adversarial-review")).toMatchObject({
      description:
        "One-round advocate, skeptic, and implementer review for stress-testing a proposed feature.",
      agents: ["advocate", "skeptic", "implementer"],
      resolve: "off",
      decision: "Build now / Reduce scope / Defer / Reject",
    });
    expect(presets.getPreset("demo-adversarial-review").goal).toBeUndefined();
    expect(presets.getPreset("demo-customer-panel")).toMatchObject({
      description:
        "One-round customer-role panel for finding first-run friction and trial-conversion blockers.",
      agents: ["new-user", "busy-operator", "skeptical-buyer"],
      resolve: "off",
      decision: "Fix now / Defer",
    });
    expect(presets.getPreset("demo-customer-panel").goal).toBeUndefined();

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
      expect(prompt).toContain("Use this decision matrix:");
      expect(prompt).toContain("After the run, review the synthesis");
      expect(prompt).not.toContain("node ../dist/cli.mjs");
      expect(prompt).not.toContain("```bash");
      expect(prompt).not.toContain("--goal");
      expect(prompt).not.toContain("--decision");
      expect(prompt).not.toContain("--resolve");
      expect(prompt).not.toContain("--timeout-ms");
      expect(prompt).not.toContain("synthesis.md");
      expect(prompt).not.toContain("run directory path");
    }
  });
});
