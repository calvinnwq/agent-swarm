import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// executeRun imports the UI attach helpers and the deterministic synthesis at
// module scope; mock both so the renderer lifecycle and the synthesis-rounds
// argument (the one behavioral difference between fresh and resumed runs) can
// be asserted precisely. The mocks are hoisted so they exist before the static
// import of the module under test triggers the mock factories.
const {
  destroyMock,
  attachLiveRendererMock,
  attachQuietLoggerMock,
  buildOrchestratorSynthesisMock,
} = vi.hoisted(() => {
  const destroy = vi.fn();
  return {
    destroyMock: destroy,
    attachLiveRendererMock: vi.fn(() => ({ destroy })),
    attachQuietLoggerMock: vi.fn(),
    buildOrchestratorSynthesisMock: vi.fn(() => ({ summary: "synth" })),
  };
});

vi.mock("../../../src/ui/index.js", () => ({
  attachLiveRenderer: attachLiveRendererMock,
  attachQuietLogger: attachQuietLoggerMock,
}));

vi.mock("../../../src/lib/synthesis.js", () => ({
  buildOrchestratorSynthesis: buildOrchestratorSynthesisMock,
}));

import {
  executeRun,
  type ExecuteRunDeps,
  type SwarmUiMode,
} from "../../../src/lib/execute-run.js";
import { OrchestratorDispatchError } from "../../../src/lib/between-rounds.js";
import {
  createRunEventFactory,
  type RoundLoopState,
} from "../../../src/lib/round-loop.js";
import type { RoundResult, RunResult } from "../../../src/lib/round-runner.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import type { CheckpointWriter } from "../../../src/lib/checkpoint-writer.js";
import type { InboxManager } from "../../../src/lib/inbox-manager.js";
import type { LedgerWriter } from "../../../src/lib/ledger-writer.js";
import type { OutputRouter } from "../../../src/lib/output-router.js";
import type {
  RoundPacket,
  RunEvent,
  RunManifest,
} from "../../../src/schemas/index.js";

const STARTED_AT = "2026-06-21T00:00:00.000Z";

function makeConfig(overrides: Partial<SwarmRunConfig> = {}): SwarmRunConfig {
  return {
    topic: "Should we ship?",
    rounds: 3,
    backend: "claude",
    preset: null,
    agents: ["alpha", "beta"],
    selectionSource: "explicit-agents",
    resolveMode: "off",
    timeoutMs: 120_000,
    goal: "ship",
    decision: "go-no-go",
    docs: [],
    commandText: "agent-swarm run",
    ...overrides,
  };
}

function makeManifest(): RunManifest {
  return {
    runId: "run-1",
    status: "running",
    topic: "Should we ship?",
    rounds: 3,
    backend: "claude",
    preset: null,
    goal: "ship",
    decision: "go-no-go",
    agents: ["alpha", "beta"],
    resolveMode: "off",
    startedAt: STARTED_AT,
    runDir: "/tmp/run",
  };
}

function makeRoundPacket(round: number): RoundPacket {
  return {
    round,
    agents: ["alpha", "beta"],
    summaries: [],
    keyObjections: [],
    sharedRisks: [],
    openQuestions: [],
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  };
}

function makeRoundResult(round: number): RoundResult {
  return { round, agentResults: [], packet: makeRoundPacket(round) };
}

function okResult(rounds: RoundResult[]): RunResult {
  return { rounds, ok: true, error: null };
}

interface Harness {
  deps: ExecuteRunDeps;
  events: RunEvent[];
  synthesisWrites: unknown[];
  finalizeCalls: Array<{ finishedAt: string; status: string }>;
  emitter: EventEmitter;
  pendingRoundWrites: Map<number, Promise<void>>;
}

function setup(
  opts: {
    uiMode?: SwarmUiMode;
    run?: () => Promise<RunResult>;
    priorRoundResults?: RoundResult[];
  } = {},
): Harness {
  const events: RunEvent[] = [];
  const synthesisWrites: unknown[] = [];
  const finalizeCalls: Array<{ finishedAt: string; status: string }> = [];

  const ledger = {
    appendEvent: (event: RunEvent) => {
      events.push(event);
    },
  } as unknown as LedgerWriter;
  const router = {
    writeRound: async () => {},
    writeSynthesis: async (synthesis: unknown) => {
      synthesisWrites.push(synthesis);
    },
    finalize: async (finishedAt: string, status: string) => {
      finalizeCalls.push({ finishedAt, status });
    },
  } as unknown as OutputRouter;
  const checkpoint = { write: vi.fn() } as unknown as CheckpointWriter;
  const inbox = {
    stage: vi.fn(),
    commit: vi.fn(),
  } as unknown as InboxManager;

  const emitter = new EventEmitter();
  const state: RoundLoopState = {
    priorPacket: null,
    orchestratorDirective: undefined,
  };
  const pendingRoundWrites = new Map<number, Promise<void>>();

  const deps: ExecuteRunDeps = {
    emitter,
    run: opts.run ?? (async () => okResult([makeRoundResult(1)])),
    uiMode: opts.uiMode ?? "silent",
    manifest: makeManifest(),
    priorRoundResults: opts.priorRoundResults ?? [],
    config: makeConfig(),
    runId: "run-1",
    seedBrief: "seed",
    startedAtIso: STARTED_AT,
    ledger,
    inbox,
    router,
    checkpoint,
    makeEvent: createRunEventFactory("run-1"),
    state,
    completedRoundPackets: [],
    completedRoundResults: [],
    orchestratorPasses: [],
    roundBriefs: new Map(),
    activeRoundMessages: new Map(),
    pendingRoundWrites,
  };

  return {
    deps,
    events,
    synthesisWrites,
    finalizeCalls,
    emitter,
    pendingRoundWrites,
  };
}

describe("executeRun", () => {
  afterEach(() => {
    destroyMock.mockReset();
    attachLiveRendererMock.mockClear();
    attachQuietLoggerMock.mockClear();
    buildOrchestratorSynthesisMock.mockClear();
  });

  it("builds synthesis from the run's rounds, writes it, finalizes done, and returns 0 on success", async () => {
    const rounds = [makeRoundResult(1), makeRoundResult(2)];
    const h = setup({ run: async () => okResult(rounds) });

    const code = await executeRun(h.deps);

    expect(code).toBe(0);
    expect(buildOrchestratorSynthesisMock).toHaveBeenCalledWith(
      h.deps.manifest,
      rounds,
    );
    expect(h.synthesisWrites).toEqual([{ summary: "synth" }]);
    expect(h.events.map((e) => e.kind)).toContain("run:completed");
    expect(h.finalizeCalls).toEqual([
      { finishedAt: expect.any(String), status: "done" },
    ]);
  });

  it("prepends priorRoundResults to the synthesis rounds on resume", async () => {
    const prior = [makeRoundResult(1)];
    const fresh = [makeRoundResult(2)];
    const h = setup({
      priorRoundResults: prior,
      run: async () => okResult(fresh),
    });

    await executeRun(h.deps);

    expect(buildOrchestratorSynthesisMock).toHaveBeenCalledWith(
      h.deps.manifest,
      [...prior, ...fresh],
    );
  });

  it("skips synthesis, records run:failed, finalizes failed, and returns 1 when the run is not ok", async () => {
    const h = setup({
      run: async () => ({ rounds: [], ok: false, error: "boom" }),
    });

    const code = await executeRun(h.deps);

    expect(code).toBe(1);
    expect(buildOrchestratorSynthesisMock).not.toHaveBeenCalled();
    expect(h.synthesisWrites).toHaveLength(0);
    expect(h.events.map((e) => e.kind)).toContain("run:failed");
    expect(h.finalizeCalls).toEqual([
      { finishedAt: expect.any(String), status: "failed" },
    ]);
  });

  it("finalizes the run as failed and records the error when run() throws OrchestratorDispatchError", async () => {
    const h = setup({
      run: async () => {
        throw new OrchestratorDispatchError("orchestrator down");
      },
    });

    const code = await executeRun(h.deps);

    expect(code).toBe(1);
    expect(buildOrchestratorSynthesisMock).not.toHaveBeenCalled();
    const failed = h.events.find((e) => e.kind === "run:failed");
    expect(failed?.metadata).toMatchObject({ error: "orchestrator down" });
    expect(h.finalizeCalls).toEqual([
      { finishedAt: expect.any(String), status: "failed" },
    ]);
  });

  it("awaits in-flight round writes before finalizing on the orchestrator-failure path", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = setup({
      run: async () => {
        throw new OrchestratorDispatchError("down");
      },
    });
    h.pendingRoundWrites.set(1, pending);

    const promise = executeRun(h.deps);
    // Macrotask flush: run() rejected and the catch is now suspended awaiting
    // the still-unresolved pending round write, so nothing is finalized yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.finalizeCalls).toHaveLength(0);

    release();
    expect(await promise).toBe(1);
    expect(h.finalizeCalls).toEqual([
      { finishedAt: expect.any(String), status: "failed" },
    ]);
  });

  it("re-throws errors from run() that are not OrchestratorDispatchError", async () => {
    const h = setup({
      run: async () => {
        throw new Error("unexpected");
      },
    });

    await expect(executeRun(h.deps)).rejects.toThrow("unexpected");
    expect(h.finalizeCalls).toHaveLength(0);
  });

  it("attaches the live renderer and destroys it after a successful run", async () => {
    const h = setup({ uiMode: "live" });

    await executeRun(h.deps);

    expect(attachLiveRendererMock).toHaveBeenCalledWith(h.emitter);
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("destroys the live renderer even when run() throws", async () => {
    const h = setup({
      uiMode: "live",
      run: async () => {
        throw new Error("boom");
      },
    });

    await expect(executeRun(h.deps)).rejects.toThrow("boom");
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("attaches the quiet logger for uiMode quiet and neither renderer for silent", async () => {
    const quiet = setup({ uiMode: "quiet" });
    await executeRun(quiet.deps);
    expect(attachQuietLoggerMock).toHaveBeenCalledWith(quiet.emitter);
    expect(attachLiveRendererMock).not.toHaveBeenCalled();

    attachQuietLoggerMock.mockClear();
    const silent = setup({ uiMode: "silent" });
    await executeRun(silent.deps);
    expect(attachLiveRendererMock).not.toHaveBeenCalled();
    expect(attachQuietLoggerMock).not.toHaveBeenCalled();
  });

  it("attaches the shared round-loop handlers to the emitter before running", async () => {
    const h = setup({
      run: async () => {
        // Emitted only after the handlers are wired; the agent:ok ->
        // agent:completed mapping is owned by attachRoundLoopHandlers.
        h.emitter.emit("agent:ok", { round: 1, agent: "alpha" });
        return okResult([]);
      },
    });

    await executeRun(h.deps);

    expect(
      h.events.some(
        (e) => e.kind === "agent:completed" && e.agentName === "alpha",
      ),
    ).toBe(true);
  });
});
