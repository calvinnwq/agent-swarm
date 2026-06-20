import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INIT_CONFIG_YAML,
  formatInitResult,
  initProjectConfig,
  loadProjectConfig,
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
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-init-config-"));
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

describe("initProjectConfig", () => {
  it("creates .agent-swarm/config.yml with minimal safe defaults when absent", async () => {
    const cwd = await makeTempCwd();
    const result = await initProjectConfig({ cwd });

    expect(result.status).toBe("created");
    expect(result.relativePath).toBe(".agent-swarm/config.yml");
    expect(result.filePath).toBe(path.join(cwd, ".agent-swarm", "config.yml"));
    expect(result.legacyDetected).toBe(false);

    const onDisk = await readFile(result.filePath, "utf-8");
    expect(onDisk).toBe(DEFAULT_INIT_CONFIG_YAML);
  });

  it("writes a config that loadProjectConfig accepts with the documented defaults", async () => {
    const cwd = await makeTempCwd();
    await initProjectConfig({ cwd });

    const loaded = await loadProjectConfig({ cwd });
    expect(loaded?.isLegacy).toBe(false);
    expect(loaded?.relativePath).toBe(".agent-swarm/config.yml");
    expect(loaded?.config).toEqual({
      preset: "product-triad",
      resolve: "off",
      timeoutMs: 300_000,
    });
  });

  it("only creates config.yml and does not touch unrelated files", async () => {
    const cwd = await makeTempCwd();
    await initProjectConfig({ cwd });

    const entries = await readdir(path.join(cwd, ".agent-swarm"));
    expect(entries).toEqual(["config.yml"]);
  });

  it("preserves an existing config and does not overwrite without force", async () => {
    const cwd = await makeTempCwd();
    const existing = "preset: customer-panel\nresolve: orchestrator\n";
    const configPath = await writeConfigAt(cwd, ".agent-swarm", existing);

    const result = await initProjectConfig({ cwd });

    expect(result.status).toBe("exists");
    expect(result.filePath).toBe(configPath);
    expect(result.contents).toBe(existing);
    expect(await readFile(configPath, "utf-8")).toBe(existing);
  });

  it("overwrites an existing config with defaults when force is set", async () => {
    const cwd = await makeTempCwd();
    const configPath = await writeConfigAt(
      cwd,
      ".agent-swarm",
      "preset: customer-panel\n",
    );

    const result = await initProjectConfig({ cwd, force: true });

    expect(result.status).toBe("overwritten");
    expect(await readFile(configPath, "utf-8")).toBe(DEFAULT_INIT_CONFIG_YAML);
  });

  it("preserves an invalid existing config without force (no destructive write)", async () => {
    const cwd = await makeTempCwd();
    const invalid = "resolve: majority\nunknown_key: 1\n";
    const configPath = await writeConfigAt(cwd, ".agent-swarm", invalid);

    const result = await initProjectConfig({ cwd });

    expect(result.status).toBe("exists");
    expect(await readFile(configPath, "utf-8")).toBe(invalid);
  });

  it("recovers an invalid existing config with force", async () => {
    const cwd = await makeTempCwd();
    const configPath = await writeConfigAt(
      cwd,
      ".agent-swarm",
      "resolve: majority\n",
    );

    const result = await initProjectConfig({ cwd, force: true });

    expect(result.status).toBe("overwritten");
    expect(await readFile(configPath, "utf-8")).toBe(DEFAULT_INIT_CONFIG_YAML);
    await expect(loadProjectConfig({ cwd })).resolves.toMatchObject({
      config: { preset: "product-triad", resolve: "off", timeoutMs: 300_000 },
    });
  });

  it("writes the current path and leaves a legacy .swarm/config.yml untouched", async () => {
    const cwd = await makeTempCwd();
    const legacy = "preset: legacy-preset\n";
    const legacyPath = await writeConfigAt(cwd, ".swarm", legacy);

    const result = await initProjectConfig({ cwd });

    expect(result.status).toBe("created");
    expect(result.relativePath).toBe(".agent-swarm/config.yml");
    expect(result.legacyDetected).toBe(true);
    expect(await readFile(result.filePath, "utf-8")).toBe(
      DEFAULT_INIT_CONFIG_YAML,
    );
    // Legacy file is never mutated by init.
    expect(await readFile(legacyPath, "utf-8")).toBe(legacy);
  });

  it("creates the current config when legacy config probing fails", async () => {
    const cwd = await makeTempCwd();
    await mkdir(path.join(cwd, ".swarm", "config.yml"), { recursive: true });

    const result = await initProjectConfig({ cwd });

    expect(result.status).toBe("created");
    expect(result.legacyDetected).toBe(false);
    expect(await readFile(result.filePath, "utf-8")).toBe(
      DEFAULT_INIT_CONFIG_YAML,
    );
  });
});

describe("formatInitResult", () => {
  it("reports creation with the relative path", () => {
    const message = formatInitResult({
      status: "created",
      filePath: "/tmp/x/.agent-swarm/config.yml",
      relativePath: ".agent-swarm/config.yml",
      contents: DEFAULT_INIT_CONFIG_YAML,
      legacyDetected: false,
    });
    expect(message).toContain("created .agent-swarm/config.yml");
  });

  it("explains how to overwrite when the config already exists", () => {
    const message = formatInitResult({
      status: "exists",
      filePath: "/tmp/x/.agent-swarm/config.yml",
      relativePath: ".agent-swarm/config.yml",
      contents: "preset: customer-panel\n",
      legacyDetected: false,
    });
    expect(message).toContain(".agent-swarm/config.yml already exists");
    expect(message).toContain("--force");
  });

  it("notes a detected legacy config", () => {
    const message = formatInitResult({
      status: "created",
      filePath: "/tmp/x/.agent-swarm/config.yml",
      relativePath: ".agent-swarm/config.yml",
      contents: DEFAULT_INIT_CONFIG_YAML,
      legacyDetected: true,
    });
    expect(message).toContain(".swarm/config.yml");
  });
});
