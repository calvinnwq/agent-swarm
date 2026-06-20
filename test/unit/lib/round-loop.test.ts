import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import {
  attachRoundLoopHandlers,
  createRunEventFactory,
  type RoundLoopState,
} from "../../../src/lib/round-loop.js";
import { buildRoundBrief } from "../../../src/lib/brief-generator.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import type {
  AgentResult,
  RoundResult,
} from "../../../src/lib/round-runner.js";
import type { CheckpointWriter } from "../../../src/lib/checkpoint-writer.js";
import type { InboxManager } from "../../../src/lib/inbox-manager.js";
import type { LedgerWriter } from "../../../src/lib/ledger-writer.js";
import type { OutputRouter } from "../../../src/lib/output-router.js";
import type {
  AgentOutput,
  MessageEnvelope,
  RoundPacket,
  RunCheckpoint,
  RunEvent,
} from "../../../src/schemas/index.js";

function makeConfig(overrides: Partial<SwarmRunConfig> = {}): SwarmRunConfig {
  return {
    topic: "Should we ship?",
    rounds: 2,
    backend: "claude",
    preset: "product-triad",
    agents: ["alpha", "beta"],
    selectionSource: "preset",
    resolveMode: "off",
    timeoutMs: 300000,
    goal: null,
    decision: null,
    docs: [],
    commandText: "agent-swarm run",
    ...overrides,
  };
}

function makeAgentOutput(agent: string): AgentOutput {
  return {
    agent,
    round: 1,
    stance: "Adopt option B",
    recommendation: "Ship option B",
    reasoning: ["Simpler"],
    objections: [],
    risks: [],
    changesFromPriorRound: [],
    confidence: "high",
    openQuestions: [],
  };
}

function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  const agent = overrides.agent ?? "alpha";
  return {
    agent,
    ok: true,
    output: makeAgentOutput(agent),
    raw: {
      ok: true,
      exitCode: 0,
      stdout: "{}",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    },
    error: null,
    ...overrides,
  };
}

function makeRoundPacket(round: number | null): RoundPacket {
  return {
    round,
    agents: [],
    summaries: [],
    keyObjections: [],
    sharedRisks: [],
    openQuestions: [],
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
  };
}

interface Harness {
  emitter: EventEmitter;
  state: RoundLoopState;
  events: RunEvent[];
  staged: MessageEnvelope[];
  committed: string[];
  writtenRounds: Array<{ roundResult: RoundResult; brief: string }>;
  checkpoints: RunCheckpoint[];
  completedRoundPackets: RoundPacket[];
  completedRoundResults: RoundResult[];
  roundBriefs: Map<number, string>;
  activeRoundMessages: Map<number, Set<string>>;
  pendingRoundWrites: Map<number, Promise<void>>;
  config: SwarmRunConfig;
  seedBrief: string;
}

function setup(
  opts: {
    config?: SwarmRunConfig;
    state?: RoundLoopState;
    seedBrief?: string;
  } = {},
): Harness {
  const events: RunEvent[] = [];
  const staged: MessageEnvelope[] = [];
  const committed: string[] = [];
  const writtenRounds: Array<{ roundResult: RoundResult; brief: string }> = [];
  const checkpoints: RunCheckpoint[] = [];

  const ledger = {
    appendEvent: (event: RunEvent) => {
      events.push(event);
    },
  } as unknown as LedgerWriter;
  const inbox = {
    stage: (message: MessageEnvelope) => {
      staged.push(message);
    },
    commit: (agent: string) => {
      committed.push(agent);
    },
  } as unknown as InboxManager;
  const router = {
    writeRound: async (roundResult: RoundResult, brief: string) => {
      writtenRounds.push({ roundResult, brief });
    },
  } as unknown as OutputRouter;
  const checkpoint = {
    write: (value: RunCheckpoint) => {
      checkpoints.push(value);
    },
  } as unknown as CheckpointWriter;

  const emitter = new EventEmitter();
  const config = opts.config ?? makeConfig();
  const state: RoundLoopState = opts.state ?? {
    priorPacket: null,
    orchestratorDirective: undefined,
  };
  const seedBrief = opts.seedBrief ?? "SEED BRIEF";
  const completedRoundPackets: RoundPacket[] = [];
  const completedRoundResults: RoundResult[] = [];
  const roundBriefs = new Map<number, string>();
  const activeRoundMessages = new Map<number, Set<string>>();
  const pendingRoundWrites = new Map<number, Promise<void>>();

  attachRoundLoopHandlers({
    emitter,
    config,
    runId: "run-1",
    seedBrief,
    startedAtIso: "2026-06-21T00:00:00.000Z",
    ledger,
    inbox,
    router,
    checkpoint,
    makeEvent: createRunEventFactory("run-1"),
    state,
    completedRoundPackets,
    completedRoundResults,
    orchestratorPasses: [],
    roundBriefs,
    activeRoundMessages,
    pendingRoundWrites,
  });

  return {
    emitter,
    state,
    events,
    staged,
    committed,
    writtenRounds,
    checkpoints,
    completedRoundPackets,
    completedRoundResults,
    roundBriefs,
    activeRoundMessages,
    pendingRoundWrites,
    config,
    seedBrief,
  };
}

const schedulerDecision = {
  policy: "all" as const,
  selected: ["alpha", "beta"],
  reason: "all agents wake every round",
};

describe("createRunEventFactory", () => {
  it("binds the runId and stamps a fresh id + timestamp per event", () => {
    const makeEvent = createRunEventFactory("run-123");
    const first = makeEvent("run:started");
    const second = makeEvent("run:completed");

    expect(first.runId).toBe("run-123");
    expect(first.kind).toBe("run:started");
    expect(typeof first.eventId).toBe("string");
    expect(first.eventId.length).toBeGreaterThan(0);
    expect(typeof first.occurredAt).toBe("string");
    expect(second.kind).toBe("run:completed");
    expect(second.eventId).not.toBe(first.eventId);
  });

  it("merges roundNumber / agentName / metadata extras", () => {
    const makeEvent = createRunEventFactory("run-xyz");
    const event = makeEvent("agent:started", {
      roundNumber: 2,
      agentName: "alpha",
      metadata: { note: "value" },
    });

    expect(event.roundNumber).toBe(2);
    expect(event.agentName).toBe("alpha");
    expect(event.metadata).toEqual({ note: "value" });
  });
});

describe("attachRoundLoopHandlers", () => {
  it("round:start (round 1) records the seed brief, appends ledger events, and stages a task per agent", () => {
    const h = setup();

    h.emitter.emit("round:start", {
      round: 1,
      agents: ["alpha", "beta"],
      schedulerDecision,
    });

    expect(h.roundBriefs.get(1)).toBe("SEED BRIEF");
    expect(h.events.map((e) => e.kind)).toEqual([
      "scheduler:decision",
      "round:started",
    ]);
    expect(h.events[0]?.metadata).toEqual({
      policy: "all",
      selected: ["alpha", "beta"],
      reason: "all agents wake every round",
    });
    expect(h.staged).toHaveLength(2);
    expect(h.staged.map((m) => m.recipients)).toEqual([["alpha"], ["beta"]]);
    expect(h.staged.every((m) => m.kind === "task")).toBe(true);
    const active = h.activeRoundMessages.get(1);
    expect(active?.size).toBe(2);
    for (const message of h.staged) {
      expect(active?.has(message.messageId)).toBe(true);
    }
  });

  it("round:start (round > 1) builds the brief from the threaded prior packet + directive", () => {
    const priorPacket = makeRoundPacket(1);
    const state: RoundLoopState = {
      priorPacket,
      orchestratorDirective: "FOCUS ON RISK",
    };
    const h = setup({ state });

    h.emitter.emit("round:start", {
      round: 2,
      agents: ["alpha"],
      schedulerDecision,
    });

    expect(h.roundBriefs.get(2)).toBe(
      buildRoundBrief({
        config: h.config,
        round: 2,
        seedBrief: h.seedBrief,
        priorPacket,
        orchestratorDirective: "FOCUS ON RISK",
      }),
    );
    expect(h.roundBriefs.get(2)).not.toBe(h.seedBrief);
  });

  it("agent:start commits the agent inbox and appends agent:started", () => {
    const h = setup();

    h.emitter.emit("agent:start", { round: 1, agent: "alpha" });

    expect(h.committed).toEqual(["alpha"]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.kind).toBe("agent:started");
    expect(h.events[0]?.agentName).toBe("alpha");
    expect(h.events[0]?.roundNumber).toBe(1);
  });

  it("agent:ok and agent:fail append the matching ledger event", () => {
    const h = setup();

    h.emitter.emit("agent:ok", { round: 1, agent: "alpha" });
    h.emitter.emit("agent:fail", { round: 1, agent: "beta" });

    expect(h.events.map((e) => [e.kind, e.agentName])).toEqual([
      ["agent:completed", "alpha"],
      ["agent:failed", "beta"],
    ]);
  });

  it("round:done writes the artifact and, on a successful non-terminal round, advances state without checkpointing", async () => {
    const h = setup({ config: makeConfig({ rounds: 2 }) });
    const packet = makeRoundPacket(1);
    const agentResults = [
      makeAgentResult({ agent: "alpha" }),
      makeAgentResult({ agent: "beta" }),
    ];

    h.emitter.emit("round:done", { round: 1, packet, agentResults });
    await h.pendingRoundWrites.get(1);

    expect(h.writtenRounds).toHaveLength(1);
    expect(h.writtenRounds[0]?.roundResult.round).toBe(1);
    expect(h.state.priorPacket).toBe(packet);
    expect(h.completedRoundPackets).toEqual([packet]);
    expect(h.completedRoundResults).toHaveLength(1);
    expect(h.checkpoints).toHaveLength(0);
  });

  it("round:done writes a terminal-round checkpoint on the final successful round", async () => {
    const h = setup({ config: makeConfig({ rounds: 1 }) });
    const packet = makeRoundPacket(1);
    const agentResults = [
      makeAgentResult({ agent: "alpha" }),
      makeAgentResult({ agent: "beta" }),
    ];

    h.emitter.emit("round:done", { round: 1, packet, agentResults });
    await h.pendingRoundWrites.get(1);

    expect(h.checkpoints).toHaveLength(1);
    const checkpoint = h.checkpoints[0]!;
    expect(checkpoint.runId).toBe("run-1");
    expect(checkpoint.lastCompletedRound).toBe(1);
    expect(checkpoint.startedAt).toBe("2026-06-21T00:00:00.000Z");
    expect(checkpoint.completedRoundResults).toHaveLength(1);
    expect(h.events.at(-1)?.kind).toBe("round:completed");
  });

  it("round:done does not advance state when the round failed (fewer than two ok agents)", async () => {
    const h = setup({ config: makeConfig({ rounds: 1 }) });
    const packet = makeRoundPacket(1);
    const agentResults = [
      makeAgentResult({ agent: "alpha", ok: true }),
      makeAgentResult({ agent: "beta", ok: false, output: null }),
    ];

    h.emitter.emit("round:done", { round: 1, packet, agentResults });
    await h.pendingRoundWrites.get(1);

    expect(h.writtenRounds).toHaveLength(1);
    expect(h.state.priorPacket).toBeNull();
    expect(h.completedRoundPackets).toHaveLength(0);
    expect(h.completedRoundResults).toHaveLength(0);
    expect(h.checkpoints).toHaveLength(0);
  });
});
