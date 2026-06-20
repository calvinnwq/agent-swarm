import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Architecture-contract guardrails (NGX-474, milestone M15 Runtime Boundary
// Refactor). These tests lock in the *current* CLI/source ownership documented
// in ARCHITECTURE.md before any runtime code is split, so that later M15 slices
// move behavior between layers deliberately instead of letting it drift. They
// read source and docs as text only — no runtime is executed — so they are
// behavior-preserving and low-noise: each assertion fails only when the
// documented boundary actually regresses.

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(repoRoot, relativePath), "utf-8");
}

async function repoFileExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

/** Relative import specifiers in a source file, e.g. "./lib/index.js". */
function relativeImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(
    (match) => match[1],
  );
}

describe("architecture contract — ARCHITECTURE.md is the runtime source of truth", () => {
  it("documents the layered runtime, module map, and invariants", async () => {
    const architecture = await readRepoFile("ARCHITECTURE.md");

    expect(architecture).toMatch(/^# Agent Swarm — Architecture/m);

    for (const section of [
      "## 1. Layers at a glance",
      "## 2. Module map",
      "## 3. `runSwarm` lifecycle",
      "## 6. Invariants",
    ]) {
      expect(
        architecture,
        `ARCHITECTURE.md should keep section: ${section}`,
      ).toContain(section);
    }

    for (const invariant of [
      "Thin CLI",
      "Harness ≠ backend",
      "`.agent-swarm/` writes, `.swarm/` read fallback",
      "Deterministic synthesis",
      "edit `dist/`",
    ]) {
      expect(
        architecture,
        `ARCHITECTURE.md should state invariant: ${invariant}`,
      ).toContain(invariant);
    }
  });

  it("names every runtime module that owns a documented layer, and each exists on disk", async () => {
    const architecture = await readRepoFile("ARCHITECTURE.md");

    // Files whose ownership ARCHITECTURE.md §1–§3 explicitly assigns. If a
    // module is renamed or moved without updating the contract (or vice versa),
    // one half of this assertion fails.
    const ownedModules = [
      "src/cli.ts",
      "src/lib/parse-command.ts",
      "src/lib/load-project-config.ts",
      "src/lib/init-config.ts",
      "src/lib/run-swarm.ts",
      "src/lib/round-runner.ts",
      "src/lib/orchestrator-dispatcher.ts",
      "src/lib/output-router.ts",
      "src/lib/artifact-writer.ts",
      "src/lib/ledger-writer.ts",
      "src/lib/checkpoint-writer.ts",
      "src/lib/synthesis.ts",
    ];

    for (const moduleFile of ownedModules) {
      const basename = path.basename(moduleFile);
      expect(
        architecture,
        `${basename} should be named in ARCHITECTURE.md`,
      ).toContain(basename);
      expect(
        await repoFileExists(moduleFile),
        `${moduleFile} should exist where ARCHITECTURE.md documents it`,
      ).toBe(true);
    }
  });
});

describe("architecture contract — contributor docs point to it", () => {
  it("is linked from AGENTS.md, CONTRIBUTING.md, and README.md", async () => {
    const [agents, contributing, readme] = await Promise.all([
      readRepoFile("AGENTS.md"),
      readRepoFile("CONTRIBUTING.md"),
      readRepoFile("README.md"),
    ]);

    expect(agents).toContain("ARCHITECTURE.md");
    expect(
      agents,
      "AGENTS.md should frame ARCHITECTURE.md as the runtime map",
    ).toContain("contributor runtime map");
    expect(contributing).toContain("ARCHITECTURE.md");
    expect(readme).toContain("ARCHITECTURE.md");
  });
});

describe("architecture contract — src/cli.ts stays a thin command entry", () => {
  it("dispatches exactly the documented public commands and hand-off targets", async () => {
    const [cli, architecture] = await Promise.all([
      readRepoFile("src/cli.ts"),
      readRepoFile("ARCHITECTURE.md"),
    ]);

    for (const command of ["run", "init", "doctor"]) {
      expect(cli, `cli.ts should register the ${command} command`).toContain(
        `.command("${command}"`,
      );
    }

    // The behavior these commands dispatch to lives in src/lib and is pulled in
    // through the barrel, not defined in the Commander wiring.
    for (const symbol of ["runSwarm", "initProjectConfig", "runDoctor"]) {
      expect(cli, `cli.ts should delegate to ${symbol}`).toContain(symbol);
    }
    expect(architecture).toContain("runSwarm");
    expect(architecture).toContain("initProjectConfig");
  });

  it("imports only layer barrels, never deep runtime modules", async () => {
    const cli = await readRepoFile("src/cli.ts");
    const specifiers = relativeImportSpecifiers(cli);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(
        specifier,
        `cli.ts reaches into a deep module (${specifier}); import a layer barrel (…/index.js) instead`,
      ).toMatch(/\/index\.js$/);
    }
  });

  it("stays thin — behavior belongs in src/lib, not the Commander wiring", async () => {
    const cli = await readRepoFile("src/cli.ts");
    const lineCount = cli.split("\n").length;

    // Deliberate non-growth ceiling. The M15 refactor should shrink this entry
    // point; if a change pushes past the ceiling, extract behavior into src/lib
    // (and lower the ceiling) rather than raising it.
    expect(
      lineCount,
      `src/cli.ts has ${lineCount} lines; extract behavior into src/lib instead of growing the entry point`,
    ).toBeLessThanOrEqual(320);
  });
});

describe("architecture contract — Harness and Backend stay separate boundary schemas", () => {
  it("keeps BackendId narrower than HarnessId in separate schema modules", async () => {
    const [backendId, harnessId] = await Promise.all([
      readRepoFile("src/schemas/backend-id.ts"),
      readRepoFile("src/schemas/harness-id.ts"),
    ]);

    expect(backendId).toContain('z.enum(["claude", "codex"])');
    expect(harnessId).toContain('"opencode"');
    expect(harnessId).toContain('"rovo"');

    // BackendId is the run-level dial; it must not absorb harness-only dispatch
    // targets, or the Harness ≠ backend invariant has collapsed.
    expect(
      backendId,
      "backend-id should not absorb harness-only value: opencode",
    ).not.toContain('"opencode"');
    expect(
      backendId,
      "backend-id should not absorb harness-only value: rovo",
    ).not.toContain('"rovo"');
  });
});
