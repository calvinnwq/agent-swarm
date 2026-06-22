# NGX-502 Doctor Harness & Agent Availability Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `agent-swarm doctor` always report a harness availability inventory (Claude/Codex/OpenCode/Rovo) and an agent→harness summary, keeping optional-harness misses non-fatal and required-harness misses fatal with attribution, in sectioned output.

**Architecture:** All changes live in `src/lib/doctor.ts` plus its tests. The config-gated harness loop is replaced by an always-on inventory built from `listHarnessDescriptors()`; each probe (`checkHarnessCapability`, unchanged) is `ok`, or remapped to `warn` when the harness is not required by the loaded config, or kept `fail` (with `required by:`) when it is. A new agent-summary check maps configured (or default-preset) agents to harnesses. `DoctorCheck` gains a `section` field and `formatDoctorReport` groups by section.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod-inferred types, Vitest (`pnpm test` unit, `pnpm test:e2e` e2e), execa-based harness probes.

---

## Background facts (verified in the codebase)

- `src/lib/doctor.ts` currently only probes harnesses inside `if (loadedConfig) { ... }` (around line 119).
- `resolveDoctorHarnesses(config, agentRegistry, presetRegistry)` already returns `Array<{ harness: HarnessId; agents: string[] }>` mapping each harness to its attributing agents. For no/unresolvable config it returns `[{ harness: "claude", agents: [] }]` (empty `agents` ⇒ not required).
- `listHarnessDescriptors()` (`src/lib/harness-registry.ts`) returns all four descriptors in order: **claude, codex, opencode, rovo**.
- `checkHarnessCapability(harness, { env })` returns `{ name: "harness capability"; status: "ok" | "fail"; message; detail? }`. We keep the `name: "harness capability"` value unchanged so every harness check shares that name (the harness identity is already in `message`, e.g. `harness "codex" ...`).
- `resolveAgentRuntime(agent, runBackend?)` (`src/lib/harness-resolution.ts`) returns `{ agentName, harness, ... }`.
- `DEFAULT_INIT_PRESET = "product-triad"` is exported from `src/lib/init-config.ts`.
- `CLI_NAME` is imported in `doctor.ts` already (from `./identity.js`).
- Existing helpers in `doctor.ts` we reuse: `resolveAgents(names, registry)`, `resolveDoctorHarnesses(...)`.

## File structure

- **Modify:** `src/lib/doctor.ts` — add `section` to `DoctorCheck`; replace the harness loop with `buildHarnessInventory`; add `buildAgentSummary` + helpers; section-aware `formatDoctorReport`.
- **Modify:** `test/unit/lib/doctor.test.ts` — update 3 no-harness assertions; add new section/inventory/summary tests; add a `formatDoctorReport` section test.
- **Modify:** `test/unit/lib/doctor-backend.test.ts` — migrate brittle `.find(name === "harness capability")` assertions to filter-by-message; rewrite the two "no config skips harness checks" tests.
- **Modify:** `test/e2e/smoke.test.ts` — add a no-config inventory assertion.
- **Modify:** `README.md`, `SPEC.md`, `docs/site/` doctor reference — document always-on inventory + status model + agent summary.

---

## Task 1: Add `section` field and make `formatDoctorReport` section-aware

**Files:**
- Modify: `src/lib/doctor.ts` (the `DoctorCheck` interface near line 35; `formatDoctorReport` near line 511)
- Test: `test/unit/lib/doctor.test.ts` (the `describe("formatDoctorReport")` block near line 407)

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("formatDoctorReport", ...)` block in `test/unit/lib/doctor.test.ts`:

```ts
  it("groups checks under section headers in first-seen order", () => {
    const text = formatDoctorReport({
      ok: true,
      checks: [
        { name: "project config", status: "ok", message: "loaded", section: "Configuration" },
        { name: "harness capability", status: "warn", message: 'harness "codex" missing', section: "Harness inventory" },
      ],
    });
    expect(text).toContain("Configuration");
    expect(text).toContain("Harness inventory");
    expect(text.indexOf("Configuration")).toBeLessThan(text.indexOf("Harness inventory"));
    expect(text).toContain("[OK] project config: loaded");
    expect(text).toContain('[WARN] harness capability: harness "codex" missing');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts -t "groups checks under section headers"`
Expected: FAIL — section headers are not printed (no "Configuration"/"Harness inventory" lines), or a TS error that `section` is not a property of the object literal.

- [ ] **Step 3: Add `section` to `DoctorCheck`**

In `src/lib/doctor.ts`, extend the interface:

```ts
export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  message: string;
  detail?: string;
  section?: string;
}
```

- [ ] **Step 4: Make `formatDoctorReport` group by section**

Replace the body of `formatDoctorReport` in `src/lib/doctor.ts` with:

```ts
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  const sectionOrder: string[] = [];
  for (const check of report.checks) {
    const section = check.section ?? "Other";
    if (!sectionOrder.includes(section)) {
      sectionOrder.push(section);
    }
  }
  for (const section of sectionOrder) {
    lines.push(section);
    for (const check of report.checks.filter(
      (c) => (c.section ?? "Other") === section,
    )) {
      const marker =
        check.status === "ok"
          ? "OK"
          : check.status === "warn"
            ? "WARN"
            : "FAIL";
      lines.push(`  [${marker}] ${check.name}: ${check.message}`);
      if (check.detail) {
        for (const detailLine of check.detail.split("\n")) {
          lines.push(`        ${detailLine}`);
        }
      }
    }
  }
  lines.push("");
  lines.push(
    report.ok
      ? `${CLI_NAME} doctor: ready`
      : `${CLI_NAME} doctor: problems found`,
  );
  return lines.join("\n");
}
```

Note: existing formatter tests assert `toContain("[OK] a: fine")` — the new 2-space indent keeps that substring intact, so they continue to pass (their checks have no `section`, landing under an "Other" header).

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts -t "formatDoctorReport"`
Expected: PASS (new section test + the two existing formatter tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/doctor.ts test/unit/lib/doctor.test.ts
git commit -m "feat(doctor): section-aware report formatting"
```

---

## Task 2: Always-on harness inventory with required/optional status

**Files:**
- Modify: `src/lib/doctor.ts` (imports; `runDoctor` near lines 119-137; add `buildHarnessInventory` + `toInventoryCheck`)
- Test: `test/unit/lib/doctor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside `describe("runDoctor", ...)` in `test/unit/lib/doctor.test.ts`:

```ts
  it("reports the full harness inventory with no config; optional misses are warn", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    await writeFileUnder(roots.bundledAgentsDir, "product-manager.yml", agentYaml("product-manager"));
    await writeFileUnder(roots.bundledPresetsDir, "product-decision.yml",
      ["name: product-decision", "agents:", "  - product-manager"].join("\n"));

    const report = await runDoctor(roots);

    const inventory = report.checks.filter((c) => c.name === "harness capability");
    expect(inventory).toHaveLength(4);
    expect(inventory.every((c) => c.section === "Harness inventory")).toBe(true);
    const claude = inventory.find((c) => c.message.includes('harness "claude"'));
    expect(claude?.status).toBe("ok");
    const codex = inventory.find((c) => c.message.includes('harness "codex"'));
    expect(codex?.status).toBe("warn");
    expect(codex?.message).toContain("not required by current config");
    expect(report.ok).toBe(true);
  });

  it("fails the inventory only for harnesses the config requires, with attribution", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    await writeFileUnder(roots.bundledAgentsDir, "product-manager.yml", agentYaml("product-manager"));
    await writeFileUnder(roots.bundledAgentsDir, "eng-opencode.yml",
      [agentYaml("eng-opencode"), "harness: opencode"].join("\n"));
    await writeFileUnder(roots.cwd, ".agent-swarm/config.yml",
      ["agents:", "  - product-manager", "  - eng-opencode"].join("\n"));

    const report = await runDoctor(roots);

    const inventory = report.checks.filter((c) => c.name === "harness capability");
    const opencode = inventory.find((c) => c.message.includes("opencode"));
    expect(opencode?.status).toBe("fail");
    expect(opencode?.detail).toContain("required by: eng-opencode");
    const codex = inventory.find((c) => c.message.includes('harness "codex"'));
    expect(codex?.status).toBe("warn");
    expect(report.ok).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts -t "harness inventory"`
Expected: FAIL — with no config there are currently zero `harness capability` checks (`toHaveLength(4)` fails).

- [ ] **Step 3: Add imports**

In `src/lib/doctor.ts`, add to the existing imports:

```ts
import { listHarnessDescriptors } from "./harness-registry.js";
import { DEFAULT_INIT_PRESET } from "./init-config.js";
```

And extend the existing `harness-resolution.js` import to include `resolveAgentRuntime`:

```ts
import {
  backendToHarness,
  resolveAgentRuntime,
  resolveAgentRuntimes,
} from "./harness-resolution.js";
```

- [ ] **Step 4: Add section constants**

Near the top of `src/lib/doctor.ts` (after the `DoctorReport` interface), add:

```ts
const SECTION_CONFIG = "Configuration";
const SECTION_HARNESS = "Harness inventory";
const SECTION_AGENTS = "Agent summary";
```

- [ ] **Step 5: Replace the harness loop in `runDoctor`**

In `src/lib/doctor.ts`, replace the entire block:

```ts
  if (loadedConfig) {
    const harnesses = resolveDoctorHarnesses(
      loadedConfig.config,
      agentRegistry,
      presetRegistry,
    );
    for (const { harness, agents } of harnesses) {
      const check = await checkHarnessCapability(harness, {
        env: options.env,
      });
      if (check.status === "fail" && agents.length > 0) {
        const attribution = `required by: ${agents.join(", ")}`;
        check.detail = check.detail
          ? `${check.detail}\n${attribution}`
          : attribution;
      }
      checks.push(check);
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks };
```

with:

```ts
  for (const check of checks) {
    if (check.section === undefined) {
      check.section = SECTION_CONFIG;
    }
  }

  const harnessChecks = await buildHarnessInventory(
    loadedConfig,
    agentRegistry,
    presetRegistry,
    options.env,
  );
  checks.push(...harnessChecks);

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, checks };
```

- [ ] **Step 6: Add `buildHarnessInventory` and `toInventoryCheck`**

Add these functions to `src/lib/doctor.ts` (e.g. just below `resolveDoctorHarnesses`):

```ts
async function buildHarnessInventory(
  loadedConfig: LoadedProjectConfig | null,
  agentRegistry: AgentRegistry | null,
  presetRegistry: PresetRegistry | null,
  env: NodeJS.ProcessEnv | undefined,
): Promise<DoctorCheck[]> {
  const requiredByHarness = new Map<HarnessId, string[]>();
  if (loadedConfig) {
    for (const { harness, agents } of resolveDoctorHarnesses(
      loadedConfig.config,
      agentRegistry,
      presetRegistry,
    )) {
      if (agents.length > 0) {
        requiredByHarness.set(harness, agents);
      }
    }
  }

  const checks: DoctorCheck[] = [];
  for (const descriptor of listHarnessDescriptors()) {
    const probe = await checkHarnessCapability(descriptor.id, { env });
    const attributing = requiredByHarness.get(descriptor.id) ?? [];
    checks.push(toInventoryCheck(probe, attributing));
  }
  return checks;
}

function toInventoryCheck(
  probe: Awaited<ReturnType<typeof checkHarnessCapability>>,
  attributingAgents: string[],
): DoctorCheck {
  if (probe.status === "ok") {
    return {
      name: probe.name,
      status: "ok",
      message: probe.message,
      detail: probe.detail,
      section: SECTION_HARNESS,
    };
  }

  if (attributingAgents.length > 0) {
    const attribution = `required by: ${attributingAgents.join(", ")}`;
    return {
      name: probe.name,
      status: "fail",
      message: probe.message,
      detail: probe.detail ? `${probe.detail}\n${attribution}` : attribution,
      section: SECTION_HARNESS,
    };
  }

  return {
    name: probe.name,
    status: "warn",
    message: `${probe.message} (not required by current config)`,
    detail: probe.detail,
    section: SECTION_HARNESS,
  };
}
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts -t "harness inventory"`
Expected: PASS.

- [ ] **Step 8: Update the three obsolete no-harness assertions in `doctor.test.ts`**

These existing tests asserted that no harness check exists; that contract is now intentionally reversed. Apply each edit:

In the test `"reports OK when there is no project config and registries load cleanly"`, replace:

```ts
    expect(
      report.checks.find((c) => c.name === "harness capability"),
    ).toBeUndefined();
```

with:

```ts
    const inventory = report.checks.filter((c) => c.name === "harness capability");
    expect(inventory).toHaveLength(4);
    expect(inventory.find((c) => c.message.includes('harness "claude"'))?.status).toBe("ok");
```

In the test `"reports FAIL when both registries are empty"`, replace:

```ts
    expect(
      report.checks.find((c) => c.name === "harness capability"),
    ).toBeUndefined();
```

with:

```ts
    expect(
      report.checks.filter((c) => c.name === "harness capability"),
    ).toHaveLength(4);
```

In the test `"reports FAIL with an actionable message when config YAML is invalid"`, replace:

```ts
    expect(
      report.checks.find((c) => c.name === "harness capability"),
    ).toBeUndefined();
```

with:

```ts
    expect(
      report.checks.filter((c) => c.name === "harness capability"),
    ).toHaveLength(4);
```

- [ ] **Step 9: Run the full doctor unit test file**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 10: Commit**

```bash
git add src/lib/doctor.ts test/unit/lib/doctor.test.ts
git commit -m "feat(doctor): always-on harness inventory with required/optional status"
```

---

## Task 3: Migrate `doctor-backend.test.ts` to the always-on inventory

The inventory now always contains all four harnesses (claude first). Tests that did `report.checks.find((entry) => entry.name === "harness capability")` and expected the *config* harness will now get **claude** first. Fix by selecting the intended harness via its message, and rewrite the two "skips when no config" tests.

**Files:**
- Test: `test/unit/lib/doctor-backend.test.ts`

- [ ] **Step 1: Apply the canonical "filter-by-message" transform to the codex/opencode tests**

For each test listed below, replace its capability selector block:

```ts
    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
```

with (substitute `"codex"` for the codex tests, `"opencode"` for opencode tests):

```ts
    const capability = report.checks
      .filter((entry) => entry.name === "harness capability")
      .find((entry) => entry.message.includes("codex"));
```

Apply to these tests (all expect a **codex** capability):
- `"reports Codex backend selection as healthy when the preset resolves to Codex agents"`
- `"uses agent backends for harness checks when config backend is omitted"`
- `"fails when Codex is logged in but lacks exec runtime support"`
- `"reports an actionable mismatch when config backend and preset agent backends disagree"`
- `"reports actionable install guidance when the codex binary is missing"`

These tests already assert `capability?.status`/`message`/`detail`; with the correct codex check selected they pass unchanged. The claude check in those runs is not installed but **not required**, so it is `warn` and does not affect their assertions or `report.ok` (the codex requirement drives `report.ok`).

> Leave untouched (they already pass): the claude-config tests `"matches all config agents"`, `"fails with login guidance when the backend CLI is present but logged out"`, `"reports actionable install guidance when the claude binary is missing"` (claude is first AND required → `find` returns the correct check); `"probes each harness requested by configured agents"` (uses `.filter` + `arrayContaining`); the two attribution tests at the end (use `.filter().find(message includes "opencode")`); `"does not report backend mismatch for agents with explicit harnesses"` (no capability assertion).

- [ ] **Step 2: Rewrite the "skips harness capability checks when there is no config" test**

Replace the body assertions of that test:

```ts
    const capability = report.checks.find(
      (entry) => entry.name === "harness capability",
    );
    expect(capability).toBeUndefined();
    expect(report.ok).toBe(true);
```

with:

```ts
    const inventory = report.checks.filter(
      (entry) => entry.name === "harness capability",
    );
    expect(inventory).toHaveLength(4);
    expect(inventory.every((entry) => entry.status !== "fail")).toBe(true);
    expect(report.ok).toBe(true);
```

Also update that test's title to: `"reports the harness inventory without failing when there is no config"`.

(No claude stub is installed in this test, so claude probes `fail`; with no config nothing is required, so it is downgraded to `warn` and `report.ok` stays `true`.)

- [ ] **Step 3: Rewrite the "does not fail harness capability when no config backend is available" test**

Apply the identical replacement as Step 2 to this test's assertion block. Update its title to: `"keeps the harness inventory non-fatal when no config backend is available"`.

- [ ] **Step 4: Run the backend doctor test file**

Run: `pnpm exec vitest run test/unit/lib/doctor-backend.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add test/unit/lib/doctor-backend.test.ts
git commit -m "test(doctor): migrate backend tests to always-on inventory"
```

---

## Task 4: Agent → harness summary section

**Files:**
- Modify: `src/lib/doctor.ts` (`runDoctor`; add `buildAgentSummary`, `resolveSummaryAgents`, `resolvePresetAgents`)
- Test: `test/unit/lib/doctor.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `describe("runDoctor", ...)` in `test/unit/lib/doctor.test.ts`:

```ts
  it("summarizes default-preset agents and harnesses when there is no config", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    await writeFileUnder(roots.bundledAgentsDir, "product-manager.yml", agentYaml("product-manager"));
    await writeFileUnder(roots.bundledAgentsDir, "product-engineer.yml", agentYaml("product-engineer"));
    await writeFileUnder(roots.bundledPresetsDir, "product-triad.yml",
      ["name: product-triad", "agents:", "  - product-manager", "  - product-engineer"].join("\n"));

    const report = await runDoctor(roots);

    const summary = report.checks.find((c) => c.name === "agent summary");
    expect(summary?.section).toBe("Agent summary");
    expect(summary?.status).toBe("ok");
    expect(summary?.message).toContain('default preset "product-triad"');
    expect(summary?.detail).toContain("product-manager → claude");
    expect(summary?.detail).toContain("product-engineer → claude");
    expect(report.ok).toBe(true);
  });

  it("warns in the agent summary when no config and the default preset is absent", async () => {
    const roots = await makeIsolatedRoots();
    await installLoggedInClaudeStub(roots.binDir);
    await writeFileUnder(roots.bundledAgentsDir, "product-manager.yml", agentYaml("product-manager"));
    await writeFileUnder(roots.bundledPresetsDir, "product-decision.yml",
      ["name: product-decision", "agents:", "  - product-manager"].join("\n"));

    const report = await runDoctor(roots);

    const summary = report.checks.find((c) => c.name === "agent summary");
    expect(summary?.status).toBe("warn");
    expect(summary?.message).toContain("product-triad");
    expect(report.ok).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts -t "agent summary"`
Expected: FAIL — no check named `"agent summary"` exists yet (`summary` is `undefined`).

- [ ] **Step 3: Push the agent summary check in `runDoctor`**

In `src/lib/doctor.ts`, immediately before `const ok = checks.every(...)`, add:

```ts
  checks.push(
    buildAgentSummary(loadedConfig, agentRegistry, presetRegistry),
  );
```

- [ ] **Step 4: Add the summary builder + resolvers**

Add to `src/lib/doctor.ts`:

```ts
function buildAgentSummary(
  loadedConfig: LoadedProjectConfig | null,
  agentRegistry: AgentRegistry | null,
  presetRegistry: PresetRegistry | null,
): DoctorCheck {
  if (!agentRegistry) {
    return {
      name: "agent summary",
      status: "warn",
      message: "agent registry unavailable; cannot map agents to harnesses",
      section: SECTION_AGENTS,
    };
  }

  const resolved = resolveSummaryAgents(
    loadedConfig,
    agentRegistry,
    presetRegistry,
  );
  if ("error" in resolved) {
    return {
      name: "agent summary",
      status: "warn",
      message: resolved.error,
      section: SECTION_AGENTS,
    };
  }

  const runBackend = loadedConfig?.config.backend;
  const lines = resolved.agents.map((agent) => {
    const runtime = resolveAgentRuntime(agent, runBackend);
    return `${agent.name} → ${runtime.harness}`;
  });

  return {
    name: "agent summary",
    status: "ok",
    message: `${resolved.agents.length} agent(s) mapped (${resolved.sourceLabel})`,
    detail: lines.join("\n"),
    section: SECTION_AGENTS,
  };
}

function resolveSummaryAgents(
  loadedConfig: LoadedProjectConfig | null,
  agentRegistry: AgentRegistry,
  presetRegistry: PresetRegistry | null,
):
  | { agents: AgentDefinition[]; sourceLabel: string }
  | { error: string } {
  if (loadedConfig?.config.agents) {
    const agents = resolveAgents(loadedConfig.config.agents, agentRegistry);
    if (!agents) {
      return { error: "config agents could not be resolved" };
    }
    return { agents, sourceLabel: "config agents" };
  }

  if (loadedConfig?.config.preset) {
    const result = resolvePresetAgents(
      loadedConfig.config.preset,
      agentRegistry,
      presetRegistry,
    );
    return "error" in result
      ? result
      : {
          agents: result.agents,
          sourceLabel: `preset "${loadedConfig.config.preset}"`,
        };
  }

  const result = resolvePresetAgents(
    DEFAULT_INIT_PRESET,
    agentRegistry,
    presetRegistry,
  );
  return "error" in result
    ? {
        error: `default preset "${DEFAULT_INIT_PRESET}" not found; run \`${CLI_NAME} init\``,
      }
    : {
        agents: result.agents,
        sourceLabel: `default preset "${DEFAULT_INIT_PRESET}"`,
      };
}

function resolvePresetAgents(
  presetName: string,
  agentRegistry: AgentRegistry,
  presetRegistry: PresetRegistry | null,
): { agents: AgentDefinition[] } | { error: string } {
  if (!presetRegistry) {
    return { error: "preset registry unavailable" };
  }
  let preset;
  try {
    preset = presetRegistry.getPreset(presetName);
  } catch {
    return { error: `preset "${presetName}" not found` };
  }
  const agents = resolveAgents(preset.agents, agentRegistry);
  if (!agents) {
    return { error: `preset "${presetName}" references unknown agent(s)` };
  }
  return { agents };
}
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts -t "agent summary"`
Expected: PASS.

- [ ] **Step 6: Run both doctor unit files**

Run: `pnpm exec vitest run test/unit/lib/doctor.test.ts test/unit/lib/doctor-backend.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/doctor.ts test/unit/lib/doctor.test.ts
git commit -m "feat(doctor): add agent-to-harness summary section"
```

---

## Task 5: E2e — no-config doctor prints the inventory

**Files:**
- Test: `test/e2e/smoke.test.ts` (add an `it` near the existing doctor cases, ~line 172)

- [ ] **Step 1: Write the failing test**

Add inside the same `describe` block that holds the other `agent-swarm doctor` cases in `test/e2e/smoke.test.ts`:

```ts
  it("`agent-swarm doctor` prints the harness inventory with no project config", () => {
    const home = mkdtempSync(join(tmpdir(), "swarm-doctor-noconfig-"));
    const binDir = join(home, "bin");
    installClaudeStub(binDir);
    const result = spawnSync("node", [cliPath, "doctor"], {
      cwd: home,
      env: { ...process.env, HOME: home, PATH: `${binDir}:${process.env.PATH ?? ""}` },
      encoding: "utf-8",
    });
    expect(result.stdout).toContain("Harness inventory");
    expect(result.stdout).toContain('harness "claude"');
    expect(result.stdout).toContain("Agent summary");
  });
```

If `mkdtempSync` is not already imported at the top of `smoke.test.ts`, add it to the existing `node:fs` import list.

- [ ] **Step 2: Build and run the e2e test**

Run: `pnpm build && pnpm exec vitest run --config vitest.e2e.config.ts test/e2e/smoke.test.ts -t "harness inventory with no project config"`
Expected: PASS. (Order matters: `pnpm build` first so `dist/cli.mjs` reflects Tasks 1-4.)

- [ ] **Step 3: Commit**

```bash
git add test/e2e/smoke.test.ts
git commit -m "test(doctor): e2e no-config harness inventory"
```

---

## Task 6: Docs

**Files:**
- Modify: `README.md`, `SPEC.md`, and the doctor reference page under `docs/site/`

- [ ] **Step 1: Locate the doctor docs**

Run: `grep -rln "doctor" README.md SPEC.md docs/site/`
Expected: the doctor sections to edit.

- [ ] **Step 2: Update README + SPEC + docs site**

In each doctor section, document the new behavior in prose matching the surrounding style:
- `agent-swarm doctor` always prints a **Harness inventory** for Claude, Codex, OpenCode, and Rovo, even with no project config.
- A missing/unauthenticated harness is reported as **WARN** (non-fatal) unless the loaded config selects an agent/preset that requires it, in which case it is **FAIL** with `required by: <agent...>` and install/auth guidance. agent-swarm never globally requires a harness.
- An **Agent summary** section maps each configured agent (or, with no config, the default `product-triad` preset's agents) to its resolved harness.
- Output is grouped into sections (Configuration, Harness inventory, Agent summary).

Keep exit-code semantics as documented (`0` ok, `1` checks failed, `2` internal error).

- [ ] **Step 3: Commit**

```bash
git add README.md SPEC.md docs/site
git commit -m "docs(doctor): document harness inventory and agent summary"
```

---

## Task 7: Full verification

- [ ] **Step 1: Lint, typecheck, format, unit tests**

Run: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`
Expected: all green. (If `pnpm format:check` flags files, run `pnpm format` and amend the relevant commit.)

- [ ] **Step 2: E2e smoke**

Run: `pnpm smoke`
Expected: PASS (golden path + the new no-config inventory case).

- [ ] **Step 3: Final commit if anything was adjusted**

```bash
git add -A
git commit -m "chore(doctor): formatting and verification follow-ups"
```

---

## Self-review notes (spec coverage)

- AC "no-config doctor reports harness inventory" → Task 2 Step 1 test + Task 5 e2e.
- AC "missing optional harnesses don't fail no-config doctor" → Task 2 (warn downgrade) + Task 3 rewritten no-config tests.
- AC "missing required harnesses fail with guidance + `required by:`" → Task 2 second test + preserved attribution tests in Task 3.
- AC "sectioned/scannable output" → Task 1.
- AC "tests cover no-config optional inventory, config-required fatal, mixed-harness attribution" → Task 2 + Task 3 (the `eng-opencode` mixed case and preserved opencode attribution tests).
- "Update README/docs" → Task 6.
- Out-of-scope items (auto-install, model validation, scheduler, replacing probes) are untouched: `checkHarnessCapability` and `harness-capability.ts` are not modified.
