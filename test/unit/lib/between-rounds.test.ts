import { beforeEach, describe, expect, it, vi } from "vitest";

// dispatchOrchestratorPass is a module-level dependency of between-rounds.ts, so
// hoist a mock for it and drive the orchestrator branch through that mock. The
// deterministic branch (resolveMode "off") never touches it.
const { dispatchOrchestratorPassMock } = vi.hoisted(() => ({
  dispatchOrchestratorPassMock: vi.fn(),
}));

vi.mock("../../../src/lib/orchestrator-dispatcher.js", () => ({
  dispatchOrchestratorPass: dispatchOrchestratorPassMock,
}));

import {
  createBetweenRounds,
  OrchestratorDispatchError,
} from "../../../src/lib/between-rounds.js";
import { buildOrchestratorPassDirective } from "../../../src/lib/brief-generator.js";
import {
  createRunEventFactory,
  type RoundLoopState,
} from "../../../src/lib/round-loop.js";
import type { SwarmRunConfig } from "../../../src/lib/config.js";
import type { RoundResult } from "../../../src/lib/round-runner.js";
import type { CheckpointWriter } from "../../../src/lib/checkpoint-writer.js";
import type { InboxManager } from "../../../src/lib/inbox-manager.js";
import type { LedgerWriter } from "../../../src/lib/ledger-writer.js";
import type { BackendAdapter } from "../../../src/backends/index.js";
import type {
  AgentDefinition,
  MessageEnvelope,
  OrchestratorPassRecord,
  QuestionResolution,
  RoundPacket,
  RunCheckpoint,
  RunEvent,
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

function makeAgent(name: string): AgentDefinition {
  return {
    name,
    description: name,
    persona: name,
    prompt: name,
    backend: "claude",
  };
}

function makeRoundPacket(round: number | null): RoundPacket {
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

function makeResolution(question: string): QuestionResolution {
  return {
    question,
    status: "consensus",
    answer: "yes",
    basis: "agreement",
    confidence: "high",
    askedBy: ["alpha"],
    supportingAgents: ["alpha", "beta"],
    supportingReasoning: ["because"],
    relatedObjections: [],
    relatedRisks: [],
    blockingScore: 0,
  };
}

interface Harness {
  betweenRounds: ReturnType<typeof createBetweenRounds>;
  events: RunEvent[];
  staged: MessageEnvelope[];
  checkpoints: RunCheckpoint[];
  state: RoundLoopState;
  orchestratorPasses: OrchestratorPassRecord[];
  activeRoundMessages: Map<number, Set<string>>;
  pendingRoundWrites: Map<number, Promise<void>>;
  config: SwarmRunConfig;
}

function setup(
  opts: {
    config?: SwarmRunConfig;
    state?: RoundLoopState;
    orchestratorAgent?: AgentDefinition;
    resolveBackend?: (agent: AgentDefinition) => BackendAdapter;
  } = {},
): Harness {
  const events: RunEvent[] = [];
  const staged: MessageEnvelope[] = [];
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
  } as unknown as InboxManager;
  const checkpoint = {
    write: (value: RunCheckpoint) => {
      checkpoints.push(value);
    },
  } as unknown as CheckpointWriter;

  const config = opts.config ?? makeConfig();
  const state: RoundLoopState = opts.state ?? {
    priorPacket: null,
    orchestratorDirective: undefined,
  };
  const orchestratorPasses: OrchestratorPassRecord[] = [];
  const activeRoundMessages = new Map<number, Set<string>>();
  const pendingRoundWrites = new Map<number, Promise<void>>();

  const betweenRounds = createBetweenRounds({
    config,
    agents: [makeAgent("alpha"), makeAgent("beta")],
    backend: { wrapperName: "claude-cli" } as unknown as BackendAdapter,
    runId: "run-1",
    startedAtIso: STARTED_AT,
    ledger,
    inbox,
    checkpoint,
    makeEvent: createRunEventFactory("run-1"),
    state,
    completedRoundPackets: [],
    completedRoundResults: [] as RoundResult[],
    orchestratorPasses,
    activeRoundMessages,
    pendingRoundWrites,
    orchestratorAgent: opts.orchestratorAgent,
    resolveBackend: opts.resolveBackend,
    schedulerPolicy: "all",
  });

  return {
    betweenRounds,
    events,
    staged,
    checkpoints,
    state,
    orchestratorPasses,
    activeRoundMessages,
    pendingRoundWrites,
    config,
  };
}

describe("createBetweenRounds", () => {
  beforeEach(() => {
    dispatchOrchestratorPassMock.mockReset();
  });

  it("writes a pending-between-rounds checkpoint then a finalized one, both stamped with the run start", async () => {
    const h = setup();
    const packet = makeRoundPacket(1);

    const { directive } = await h.betweenRounds({ round: 1, packet });

    expect(directive).toBe(buildOrchestratorPassDirective(packet));
    expect(h.checkpoints).toHaveLength(2);
    expect(h.checkpoints[0]?.pendingBetweenRounds).toBe(true);
    expect(h.checkpoints[0]?.startedAt).toBe(STARTED_AT);
    expect(h.checkpoints[0]?.lastCompletedRound).toBe(1);
    expect(h.checkpoints[1]?.pendingBetweenRounds).toBeUndefined();
    expect(h.checkpoints[1]?.startedAt).toBe(STARTED_AT);
    expect(h.checkpoints[1]?.orchestratorDirective).toBe(directive);
  });

  it("waits for the in-flight round write to settle before checkpointing", async () => {
    const h = setup();
    let released = false;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = () => {
        released = true;
        resolve();
      };
    });
    h.pendingRoundWrites.set(1, pending);

    const promise = h.betweenRounds({ round: 1, packet: makeRoundPacket(1) });
    // Suspended awaiting the pending round write: nothing checkpointed yet.
    expect(h.checkpoints).toHaveLength(0);
    expect(released).toBe(false);

    release();
    await promise;

    expect(released).toBe(true);
    expect(h.checkpoints).toHaveLength(2);
  });

  it("stages a broadcast directive message addressed to the next round's agents and tracks it active", async () => {
    const h = setup();

    await h.betweenRounds({ round: 1, packet: makeRoundPacket(1) });

    expect(h.staged).toHaveLength(1);
    const message = h.staged[0]!;
    expect(message.kind).toBe("broadcast");
    expect(message.senderId).toBe("orchestrator");
    expect(message.roundNumber).toBe(2);
    expect(message.recipients).toEqual(["alpha", "beta"]);
    expect(message.payload).toMatchObject({ fromRound: 1 });
    const active = h.activeRoundMessages.get(2);
    expect(active?.has(message.messageId)).toBe(true);
  });

  it("appends orchestrator:pass then round:completed ledger events without metadata on the deterministic path", async () => {
    const h = setup();

    await h.betweenRounds({ round: 2, packet: makeRoundPacket(2) });

    expect(h.events.map((e) => [e.kind, e.roundNumber])).toEqual([
      ["orchestrator:pass", 2],
      ["round:completed", 2],
    ]);
    expect(h.events[0]?.metadata).toBeUndefined();
  });

  it("falls back to the deterministic directive when resolveMode is orchestrator but no orchestratorAgent is supplied", async () => {
    const h = setup({ config: makeConfig({ resolveMode: "orchestrator" }) });
    const packet = makeRoundPacket(1);

    const { directive } = await h.betweenRounds({ round: 1, packet });

    expect(dispatchOrchestratorPassMock).not.toHaveBeenCalled();
    expect(directive).toBe(buildOrchestratorPassDirective(packet));
  });

  it("applies the orchestrator directive, mutates the packet, and records a pass on success", async () => {
    const orchestratorAgent = makeAgent("orchestrator");
    const resolveBackend = vi.fn(
      () => ({ wrapperName: "orch-cli" }) as unknown as BackendAdapter,
    );
    dispatchOrchestratorPassMock.mockResolvedValue({
      ok: true,
      output: {
        round: 2,
        directive: "llm-derived directive",
        questionResolutions: [makeResolution("Which DB?")],
        questionResolutionLimit: 1,
        deferredQuestions: ["scale later?"],
        confidence: "high",
      },
      raw: {
        ok: true,
        exitCode: 0,
        stdout: "{}",
        stderr: "",
        timedOut: false,
        durationMs: 5,
      },
    });
    const h = setup({
      config: makeConfig({ resolveMode: "orchestrator" }),
      orchestratorAgent,
      resolveBackend,
    });
    const packet = makeRoundPacket(1);

    const { directive } = await h.betweenRounds({ round: 1, packet });

    expect(resolveBackend).toHaveBeenCalledWith(orchestratorAgent);
    expect(directive).toBe("llm-derived directive");
    expect(packet.questionResolutions).toHaveLength(1);
    expect(packet.questionResolutions[0]?.question).toBe("Which DB?");
    expect(packet.deferredQuestions).toEqual(["scale later?"]);
    expect(packet.questionResolutionLimit).toBe(1);
    expect(h.orchestratorPasses).toHaveLength(1);
    expect(h.orchestratorPasses[0]).toMatchObject({
      round: 1,
      agentName: "orchestrator",
    });
    expect(h.state.orchestratorDirective).toBe("llm-derived directive");

    const passEvent = h.events.find((e) => e.kind === "orchestrator:pass");
    expect(passEvent?.metadata).toMatchObject({
      agentName: "orchestrator",
      directive: "llm-derived directive",
      confidence: "high",
      questionResolutionsCount: 1,
      questionResolutionLimit: 1,
      deferredQuestionsCount: 1,
    });
  });

  it("throws OrchestratorDispatchError and skips staging when the orchestrator dispatch fails", async () => {
    const orchestratorAgent = makeAgent("orchestrator");
    dispatchOrchestratorPassMock.mockResolvedValue({
      ok: false,
      error: "backend exited with code 1",
      raw: null,
    });
    const h = setup({
      config: makeConfig({ resolveMode: "orchestrator" }),
      orchestratorAgent,
    });

    await expect(
      h.betweenRounds({ round: 1, packet: makeRoundPacket(1) }),
    ).rejects.toBeInstanceOf(OrchestratorDispatchError);
    // Failure happens after the pending checkpoint but before staging/finalizing.
    expect(h.staged).toHaveLength(0);
    expect(h.checkpoints).toHaveLength(1);
    expect(h.checkpoints[0]?.pendingBetweenRounds).toBe(true);
    expect(h.orchestratorPasses).toHaveLength(0);
  });
});
