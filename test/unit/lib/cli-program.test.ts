import { describe, expect, it } from "vitest";
import { buildCliProgram, CLI_NAME } from "../../../src/lib/index.js";

// NGX-475 (M15-02): command routing now lives in src/lib/cli-program.ts so
// src/cli.ts can stay a thin bin shim. buildCliProgram() constructs the
// Commander program without parsing argv or exiting, so the command surface
// can be asserted directly.

describe("buildCliProgram", () => {
  it("names the program and exposes the package version", () => {
    const program = buildCliProgram("9.9.9");
    expect(program.name()).toBe(CLI_NAME);
    expect(program.version()).toBe("9.9.9");
  });

  it("registers exactly the run, init, and doctor commands", () => {
    const program = buildCliProgram("9.9.9");
    const names = program.commands.map((command) => command.name()).sort();
    expect(names).toEqual(["doctor", "init", "run"]);
  });

  it("preserves the documented run option surface", () => {
    const program = buildCliProgram("9.9.9");
    const run = program.commands.find((command) => command.name() === "run");
    expect(run).toBeDefined();
    const longFlags = run!.options.map((option) => option.long);
    for (const flag of [
      "--agents",
      "--resolve",
      "--goal",
      "--decision",
      "--doc",
      "--preset",
      "--backend",
      "--timeout-ms",
      "--quiet",
    ]) {
      expect(longFlags, `run should keep ${flag}`).toContain(flag);
    }
  });

  it("keeps the --force flag on init", () => {
    const program = buildCliProgram("9.9.9");
    const init = program.commands.find((command) => command.name() === "init");
    expect(init).toBeDefined();
    expect(init!.options.map((option) => option.long)).toContain("--force");
  });
});
