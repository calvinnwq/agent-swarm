import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.mjs", import.meta.url));

function runCli(
  args: string[],
  cwd?: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    cwd,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

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
  const dir = await mkdtemp(path.join(tmpdir(), "swarm-cli-init-"));
  tempDirs.push(dir);
  return dir;
}

describe("agent-swarm init", () => {
  it("lists init in top-level help", () => {
    const { status, stdout } = runCli(["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("init");
  });

  it("creates .agent-swarm/config.yml with safe defaults and exits 0", async () => {
    const cwd = await makeTempCwd();
    const { status, stdout } = runCli(["init"], cwd);

    expect(status).toBe(0);
    expect(stdout).toContain("created .agent-swarm/config.yml");

    const contents = await readFile(
      path.join(cwd, ".agent-swarm", "config.yml"),
      "utf-8",
    );
    expect(contents).toContain("preset: product-triad");
    expect(contents).toContain("resolve: off");
    expect(contents).toContain("timeoutMs: 300000");
  });

  it("leaves an existing config unchanged without --force and exits 0", async () => {
    const cwd = await makeTempCwd();
    const configDir = path.join(cwd, ".agent-swarm");
    await mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "config.yml");
    await writeFile(configPath, "preset: customer-panel\n", "utf-8");

    const { status, stdout } = runCli(["init"], cwd);

    expect(status).toBe(0);
    expect(stdout).toContain("already exists");
    expect(stdout).toContain("--force");
    expect(await readFile(configPath, "utf-8")).toBe(
      "preset: customer-panel\n",
    );
  });

  it("overwrites with --force and stays compatible with doctor", async () => {
    const cwd = await makeTempCwd();
    const configDir = path.join(cwd, ".agent-swarm");
    await mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, "config.yml");
    await writeFile(configPath, "preset: customer-panel\n", "utf-8");

    const init = runCli(["init", "--force"], cwd);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain("overwrote .agent-swarm/config.yml");
    expect(await readFile(configPath, "utf-8")).toContain(
      "preset: product-triad",
    );

    // The generated config must parse cleanly: doctor reports the project config
    // check as OK (not a parse/validation failure).
    const doctor = runCli(["doctor"], cwd);
    expect(doctor.stdout).toContain("loaded .agent-swarm/config.yml");
    expect(doctor.stdout).not.toMatch(/\[FAIL\] project config/);
  });
});
