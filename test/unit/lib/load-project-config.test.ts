import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  PROJECT_CONFIG_RELATIVE_PATH,
  SwarmCommandError,
} from "../../../src/lib/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempCwd(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-project-config-"));
  tempDirs.push(dir);
  return dir;
}

async function writeConfigAt(
  cwd: string,
  dir: string,
  contents: string,
): Promise<string> {
  const configDir = path.join(cwd, dir);
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.yml");
  await writeFile(configPath, contents, "utf-8");
  return configPath;
}

// Legacy default: existing tests write to `.swarm/` and exercise the
// backward-compatible fallback read path.
async function writeConfig(cwd: string, contents: string): Promise<string> {
  return writeConfigAt(cwd, ".swarm", contents);
}

describe("loadProjectConfig", () => {
  it("returns null when .swarm/config.yml does not exist", async () => {
    const cwd = await makeTempCwd();
    await expect(loadProjectConfig({ cwd })).resolves.toBeNull();
  });

  it("loads and validates a valid config", async () => {
    const cwd = await makeTempCwd();
    const configPath = await writeConfig(
      cwd,
      [
        "preset: product-decision",
        "resolve: orchestrator",
        "timeoutMs: 300000",
        "agents:",
        "  - product-manager",
        "  - principal-engineer",
        "goal: ship the slice",
      ].join("\n"),
    );
    const result = await loadProjectConfig({ cwd });
    expect(result).not.toBeNull();
    expect(result?.filePath).toBe(configPath);
    expect(result?.config).toEqual({
      preset: "product-decision",
      resolve: "orchestrator",
      timeoutMs: 300_000,
      agents: ["product-manager", "principal-engineer"],
      goal: "ship the slice",
    });
  });

  it("treats an empty config file as empty config object", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "");
    const result = await loadProjectConfig({ cwd });
    expect(result?.config).toEqual({});
  });

  it("throws a SwarmCommandError with actionable message on invalid YAML", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "agents:\n  - a\n -b\n");
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(SwarmCommandError);
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(
      /invalid YAML in \.swarm\/config\.yml/,
    );
  });

  it("throws with path-qualified messages on schema violations", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, ["resolve: majority"].join("\n"));
    await expect(loadProjectConfig({ cwd })).rejects.toThrowError(
      /invalid \.swarm\/config\.yml/,
    );
    await expect(loadProjectConfig({ cwd })).rejects.toThrowError(/resolve/);
  });

  it("rejects unknown top-level keys (strict)", async () => {
    const cwd = await makeTempCwd();
    await writeConfig(cwd, "totally_unknown: yes\n");
    await expect(loadProjectConfig({ cwd })).rejects.toThrow(/totally_unknown/);
  });

  it("exposes the relative path constant", () => {
    expect(PROJECT_CONFIG_RELATIVE_PATH).toBe(".agent-swarm/config.yml");
  });

  it("loads the current .agent-swarm/config.yml and marks it as not legacy", async () => {
    const cwd = await makeTempCwd();
    const configPath = await writeConfigAt(
      cwd,
      ".agent-swarm",
      "preset: product-decision\n",
    );
    const result = await loadProjectConfig({ cwd });
    expect(result?.filePath).toBe(configPath);
    expect(result?.relativePath).toBe(".agent-swarm/config.yml");
    expect(result?.isLegacy).toBe(false);
    expect(result?.config).toEqual({ preset: "product-decision" });
  });

  it("falls back to legacy .swarm/config.yml and marks it as legacy", async () => {
    const cwd = await makeTempCwd();
    const configPath = await writeConfigAt(
      cwd,
      ".swarm",
      "preset: product-decision\n",
    );
    const result = await loadProjectConfig({ cwd });
    expect(result?.filePath).toBe(configPath);
    expect(result?.relativePath).toBe(".swarm/config.yml");
    expect(result?.isLegacy).toBe(true);
    expect(result?.config).toEqual({ preset: "product-decision" });
  });

  it("prefers current .agent-swarm/config.yml over legacy .swarm/config.yml when both exist", async () => {
    const cwd = await makeTempCwd();
    await writeConfigAt(cwd, ".swarm", "preset: legacy-preset\n");
    const currentPath = await writeConfigAt(
      cwd,
      ".agent-swarm",
      "preset: current-preset\n",
    );
    const result = await loadProjectConfig({ cwd });
    expect(result?.filePath).toBe(currentPath);
    expect(result?.isLegacy).toBe(false);
    expect(result?.config).toEqual({ preset: "current-preset" });
  });

  it("surfaces the current path in errors when .agent-swarm/config.yml is invalid even if a legacy file exists", async () => {
    const cwd = await makeTempCwd();
    await writeConfigAt(cwd, ".swarm", "preset: legacy-preset\n");
    await writeConfigAt(cwd, ".agent-swarm", "resolve: majority\n");
    await expect(loadProjectConfig({ cwd })).rejects.toThrowError(
      /invalid \.agent-swarm\/config\.yml/,
    );
  });
});
