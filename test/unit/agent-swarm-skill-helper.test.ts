import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const helperPath = path.join(
  repoRoot,
  ".agents",
  "skills",
  "agent-swarm",
  "scripts",
  "agent-swarm-helper.mjs",
);
const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-swarm-skill-helper-"));
  tempDirs.push(dir);
  return dir;
}

async function runHelper(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [
    helperPath,
    ...args,
  ]);
  return stdout.trim();
}

describe("agent-swarm skill helper", () => {
  it("builds a quoted run command from deterministic inputs", async () => {
    const stdout = await runHelper([
      "build-run-command",
      "--question",
      "Should we ship Bob's plan?",
      "--preset",
      "product-triad",
      "--decision",
      "Proceed / Defer / Reject",
      "--doc",
      "docs/agent-operation.md",
      "--doc",
      "docs/agent-usage.md",
      "--built-cli",
      "--json",
    ]);
    const result = JSON.parse(stdout);

    expect(result.argv).toEqual([
      "node",
      "../dist/cli.mjs",
      "run",
      "1",
      "Should we ship Bob's plan?",
      "--preset",
      "product-triad",
      "--goal",
      "Help answer: Should we ship Bob's plan?",
      "--resolve",
      "off",
      "--timeout-ms",
      "600000",
      "--quiet",
      "--decision",
      "Proceed / Defer / Reject",
      "--doc",
      "docs/agent-operation.md",
      "--doc",
      "docs/agent-usage.md",
    ]);
    expect(result.command).toContain("node ../dist/cli.mjs run 1");
    expect(result.command).toContain("'Should we ship Bob'\\''s plan?'");
    expect(result.command).toContain("--preset product-triad");
  });

  it("rejects invalid command construction inputs", async () => {
    await expect(
      execFileAsync(process.execPath, [
        helperPath,
        "build-run-command",
        "--question",
        "Question",
        "--preset",
        "product-triad",
        "--resolve",
        "majority",
      ]),
    ).rejects.toThrow("--resolve must be one of");
    await expect(
      execFileAsync(process.execPath, [
        helperPath,
        "build-run-command",
        "--question",
        "Question",
        "--preset",
        "",
      ]),
    ).rejects.toThrow("--preset requires a value");
  });

  it("inspects the newest run artifact from a local fixture", async () => {
    const project = await tempProject();
    const runsDir = path.join(project, ".agent-swarm", "runs");
    const olderRun = path.join(runsDir, "20260101-000000-old");
    const newestRun = path.join(runsDir, "20260102-000000-new");
    await mkdir(olderRun, { recursive: true });
    await mkdir(newestRun, { recursive: true });
    await writeFile(
      path.join(newestRun, "manifest.json"),
      JSON.stringify(
        {
          topic: "Which default preset should we use?",
          status: "done",
          preset: "product-triad",
          agents: ["product-manager", "product-engineer"],
          agentRuntimes: [{ agentName: "product-manager", harness: "claude" }],
        },
        null,
        2,
      ),
    );
    await writeFile(
      path.join(newestRun, "synthesis.md"),
      "# Synthesis\n\nShip it.",
    );
    await utimes(olderRun, new Date("2026-01-01"), new Date("2026-01-01"));
    await utimes(newestRun, new Date("2026-01-02"), new Date("2026-01-02"));

    const stdout = await runHelper([
      "inspect-latest-run",
      "--project-dir",
      project,
      "--json",
    ]);
    const result = JSON.parse(stdout);

    expect(result.runDir).toBe(newestRun);
    expect(result.topic).toBe("Which default preset should we use?");
    expect(result.status).toBe("done");
    expect(result.preset).toBe("product-triad");
    expect(result.agents).toEqual(["product-manager", "product-engineer"]);
    expect(result.hasSynthesis).toBe(true);
    expect(result.synthesisPreview).toContain("Ship it.");
  });

  it("keeps the helper script in the packaged repo skill directory", () => {
    expect(helperPath).toContain(
      ".agents/skills/agent-swarm/scripts/agent-swarm-helper.mjs",
    );
    expect(repoRoot).toContain("agent-swarm");
  });
});
