import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentRegistry, loadPresetRegistry } from "../../src/lib/index.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const bundledAgentsDir = path.join(repoRoot, "src", "agents", "bundled");
const bundledPresetsDir = path.join(repoRoot, "src", "presets", "bundled");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("first-time default presets", () => {
  it("keeps bundled primary personas grouped without moving special runtime variants", async () => {
    await Promise.all([
      access(path.join(bundledAgentsDir, "product", "product-manager.yml")),
      access(path.join(bundledAgentsDir, "product", "product-engineer.yml")),
      access(path.join(bundledAgentsDir, "product", "product-designer.yml")),
      access(
        path.join(bundledAgentsDir, "engineering", "principal-engineer.yml"),
      ),
      access(path.join(bundledAgentsDir, "engineering", "code-reviewer.yml")),
      access(
        path.join(
          bundledAgentsDir,
          "engineering",
          "implementation-skeptic.yml",
        ),
      ),
      access(
        path.join(bundledAgentsDir, "engineering", "test-risk-reviewer.yml"),
      ),
      access(path.join(bundledAgentsDir, "customer", "first-time-user.yml")),
      access(path.join(bundledAgentsDir, "customer", "busy-operator.yml")),
      access(path.join(bundledAgentsDir, "customer", "skeptical-buyer.yml")),
      access(path.join(bundledAgentsDir, "orchestrator.yml")),
      access(path.join(bundledAgentsDir, "product-manager-codex.yml")),
      access(path.join(bundledAgentsDir, "principal-engineer-codex.yml")),
      access(path.join(bundledAgentsDir, "product-manager-opencode.yml")),
      access(path.join(bundledAgentsDir, "principal-engineer-opencode.yml")),
    ]);
  });

  it("ships non-demo default presets backed by bundled agents", async () => {
    const cwd = await tempDir("agent-swarm-defaults-cwd-");
    const homeDir = await tempDir("agent-swarm-defaults-home-");

    const [agents, presets] = await Promise.all([
      loadAgentRegistry({ cwd, homeDir, bundledDir: bundledAgentsDir }),
      loadPresetRegistry({ cwd, homeDir, bundledDir: bundledPresetsDir }),
    ]);

    expect(presets.getPreset("product-triad")).toMatchObject({
      agents: ["product-manager", "product-engineer", "product-designer"],
      resolve: "orchestrator",
      decision: "Proceed / Defer / Reject",
    });
    expect(presets.getPreset("adversarial-code-review")).toMatchObject({
      agents: ["code-reviewer", "implementation-skeptic", "test-risk-reviewer"],
      resolve: "orchestrator",
      decision: "Ready / Revise / Reject",
    });
    expect(presets.getPreset("customer-panel")).toMatchObject({
      agents: ["first-time-user", "busy-operator", "skeptical-buyer"],
      resolve: "orchestrator",
      decision: "Fix now / Defer / Reject",
    });

    for (const presetName of [
      "product-triad",
      "adversarial-code-review",
      "customer-panel",
    ]) {
      const preset = presets.getPreset(presetName);
      expect(preset.name).not.toContain("demo");
      for (const agentName of preset.agents) {
        expect(agents.getAgent(agentName).name).toBe(agentName);
      }
    }
  });
});
