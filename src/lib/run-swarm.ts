import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentDefinition,
  OrchestratorPassRecord,
  ResolvedAgentRuntime,
  RunManifest,
  RunEvent,
  RoundPacket,
  MessageEnvelope,
} from "../schemas/index.js";
import type { BackendAdapter } from "../backends/index.js";
import type { SwarmRunConfig } from "./config.js";
import { createRoundRunner } from "./round-runner.js";
import type {
  AgentRuntimeResolver,
  BackendAdapterResolver,
  RoundResult,
} from "./round-runner.js";
import { selectAgentsForRound, type SchedulerPolicy } from "./scheduler.js";
import { ArtifactWriter } from "./artifact-writer.js";
import { buildRunDirName } from "./artifact-writer.js";
import {
  buildSeedBrief,
  buildOrchestratorPassDirective,
} from "./brief-generator.js";
import { buildOrchestratorSynthesis } from "./synthesis.js";
import { STORAGE_DIR } from "./identity.js";
import { attachLiveRenderer, attachQuietLogger } from "../ui/index.js";
import { OutputRouter } from "./output-router.js";
import type { OutputTarget } from "./output-router.js";
import { LedgerWriter } from "./ledger-writer.js";
import { InboxManager } from "./inbox-manager.js";
import { CheckpointWriter } from "./checkpoint-writer.js";
import {
  loadCarryForwardDocSnapshots,
  materializeCarryForwardDocPackets,
} from "./doc-inputs.js";
import { dispatchOrchestratorPass } from "./orchestrator-dispatcher.js";
import {
  roundPacketsToResults,
  checkpointRoundResults,
  restoreCheckpointRoundResults,
} from "./round-results.js";
import { packetWithPriorResolutionContext } from "./resolution-context.js";
import {
  attachRoundLoopHandlers,
  createRunEventFactory,
  type RoundLoopState,
} from "./round-loop.js";

export class OrchestratorDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorDispatchError";
  }
}

export type SwarmUiMode = "live" | "quiet" | "silent";

export interface ResumeSwarmOpts {
  config: SwarmRunConfig;
  agents: AgentDefinition[];
  backend: BackendAdapter;
  /** Directory of the interrupted run to resume from */
  runDir: string;
  ui?: SwarmUiMode;
  additionalTargets?: OutputTarget[];
  schedulerPolicy?: SchedulerPolicy;
  /**
   * Per-agent adapter resolver. When provided, each agent dispatches via
   * the adapter returned for it; `backend` is the default fallback and is
   * still used for run-level metadata such as wrapperName.
   */
  resolveBackend?: BackendAdapterResolver;
  /**
   * Per-agent runtime resolver. Returns the ResolvedAgentRuntime for each
   * agent so artifacts can record what actually ran (harness + model).
   */
  resolveRuntime?: AgentRuntimeResolver;
  /**
   * Resolved runtimes captured for the run. Persisted to manifest.json so
   * post-hoc tooling can inspect what harness/model each agent ran with.
   */
  agentRuntimes?: readonly ResolvedAgentRuntime[];
  /**
   * Agent definition used for the orchestrator resolution pass when
   * `config.resolveMode === "orchestrator"`. When omitted, the
   * deterministic between-round directive is used regardless of mode.
   */
  orchestratorAgent?: AgentDefinition;
}

export interface RunSwarmOpts {
  config: SwarmRunConfig;
  agents: AgentDefinition[];
  backend: BackendAdapter;
  /** Base directory for run artifacts (default: ".agent-swarm/runs") */
  baseDir?: string;
  /** Override start time for deterministic output */
  startedAt?: Date;
  /**
   * Terminal output mode. Defaults to "live" when stderr is a TTY, else "quiet".
   * "silent" disables UI attachment (artifacts still written).
   */
  ui?: SwarmUiMode;
  /**
   * Additional output targets routed alongside the default disk writer.
   * Each target receives the same lifecycle events: init, writeRound,
   * writeSynthesis, and finalize.
   */
  additionalTargets?: OutputTarget[];
  /**
   * Wake-selection policy for each round. Defaults to "all" (every agent
   * runs every round). Use "addressed-only" to restrict later rounds to
   * agents that successfully responded in the prior round.
   */
  schedulerPolicy?: SchedulerPolicy;
  /**
   * Per-agent adapter resolver. When provided, each agent dispatches via
   * the adapter returned for it; `backend` is the default fallback and is
   * still used for run-level metadata such as wrapperName.
   */
  resolveBackend?: BackendAdapterResolver;
  /**
   * Per-agent runtime resolver. Returns the ResolvedAgentRuntime for each
   * agent so artifacts can record what actually ran (harness + model).
   */
  resolveRuntime?: AgentRuntimeResolver;
  /**
   * Resolved runtimes captured for the run. Persisted to manifest.json so
   * post-hoc tooling can inspect what harness/model each agent ran with.
   */
  agentRuntimes?: readonly ResolvedAgentRuntime[];
  /**
   * Agent definition used for the orchestrator resolution pass when
   * `config.resolveMode === "orchestrator"`. When omitted, the
   * deterministic between-round directive is used regardless of mode.
   */
  orchestratorAgent?: AgentDefinition;
}

/**
 * Full pipeline orchestrator: runs rounds, writes artifacts, synthesizes.
 * Returns 0 on success, 1 on failure.
 */
export async function runSwarm(opts: RunSwarmOpts): Promise<number> {
  const { config, agents, backend } = opts;
  const baseDir = opts.baseDir ?? `${STORAGE_DIR}/runs`;
  const startedAt = opts.startedAt ?? new Date();
  const startedAtIso = startedAt.toISOString();

  const runDir = join(baseDir, buildRunDirName(startedAt, config.topic));

  const manifest: RunManifest = {
    runId: randomUUID(),
    status: "running",
    topic: config.topic,
    rounds: config.rounds,
    backend: config.backend,
    preset: config.preset,
    goal: config.goal,
    decision: config.decision,
    agents: config.agents,
    ...(opts.agentRuntimes ? { agentRuntimes: [...opts.agentRuntimes] } : {}),
    resolveMode: config.resolveMode,
    startedAt: startedAtIso,
    runDir,
  };

  const carryForwardDocPackets =
    config.docs.length > 0
      ? await materializeCarryForwardDocPackets(config.docs)
      : [];
  const seedBrief = buildSeedBrief(config, carryForwardDocPackets);

  const writer = new ArtifactWriter({
    baseDir,
    manifest,
    seedBrief,
    wrapperName: backend.wrapperName ?? `${config.backend}-cli`,
    carryForwardDocPackets,
  });
  const ledger = new LedgerWriter(runDir);
  const checkpoint = new CheckpointWriter(runDir);
  const inbox = new InboxManager(ledger);
  const router = new OutputRouter([
    writer,
    ledger,
    ...(opts.additionalTargets ?? []),
  ]);
  await router.init();

  const makeEvent = createRunEventFactory(manifest.runId);

  ledger.appendEvent(makeEvent("run:started"));

  // Track round briefs for artifact writing
  const roundBriefs = new Map<number, string>();
  const loopState: RoundLoopState = {
    priorPacket: null,
    orchestratorDirective: undefined,
  };
  const completedRoundPackets: RoundPacket[] = [];
  const completedRoundResults: RoundResult[] = [];
  const orchestratorPasses: OrchestratorPassRecord[] = [];
  const pendingRoundWrites = new Map<number, Promise<void>>();
  const activeRoundMessages = new Map<number, Set<string>>();

  const awaitRoundWrite = async (round: number) => {
    const pending = pendingRoundWrites.get(round);
    if (pending) await pending;
  };

  const betweenRounds = async ({
    round,
    packet,
  }: {
    round: number;
    packet: RoundPacket;
  }) => {
    await awaitRoundWrite(round);

    checkpoint.write({
      runId: manifest.runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: loopState.orchestratorDirective,
      ...(orchestratorPasses.length > 0
        ? { orchestratorPasses: [...orchestratorPasses] }
        : {}),
      pendingBetweenRounds: true,
      checkpointedAt: new Date().toISOString(),
      startedAt: startedAtIso,
    });

    let directive = buildOrchestratorPassDirective(packet);
    let orchestratorPassMetadata: RunEvent["metadata"] | undefined;
    if (
      config.resolveMode === "orchestrator" &&
      opts.orchestratorAgent !== undefined
    ) {
      const orchAgent = opts.orchestratorAgent;
      const orchBackend = opts.resolveBackend?.(orchAgent) ?? backend;
      const result = await dispatchOrchestratorPass({
        backend: orchBackend,
        agent: orchAgent,
        packet: packetWithPriorResolutionContext(packet, orchestratorPasses),
        goal: config.goal,
        decision: config.decision,
        nextRound: round + 1,
        timeoutMs: config.timeoutMs,
      });
      if (!result.ok) {
        throw new OrchestratorDispatchError(
          `Orchestrator dispatch failed: ${result.error}`,
        );
      }
      directive = result.output.directive;
      packet.questionResolutions = result.output.questionResolutions;
      packet.questionResolutionLimit = result.output.questionResolutionLimit;
      packet.deferredQuestions = result.output.deferredQuestions;
      orchestratorPasses.push({
        round,
        agentName: orchAgent.name,
        output: result.output,
      });
      orchestratorPassMetadata = {
        agentName: orchAgent.name,
        directive,
        confidence: result.output.confidence,
        questionResolutionsCount: result.output.questionResolutions.length,
        questionResolutionLimit: result.output.questionResolutionLimit,
        deferredQuestionsCount: result.output.deferredQuestions.length,
      };
    }
    loopState.orchestratorDirective = directive;

    const directiveRecipients = selectAgentsForRound(
      agents,
      round + 1,
      packet,
      opts.schedulerPolicy ?? "all",
    ).selected;
    const message: MessageEnvelope = {
      messageId: randomUUID(),
      senderId: "orchestrator",
      recipients: directiveRecipients,
      kind: "broadcast",
      payload: { directive, fromRound: round },
      deliveryStatus: "staged",
      createdAt: new Date().toISOString(),
      roundNumber: round + 1,
    };
    inbox.stage(message);
    let activeMessages = activeRoundMessages.get(round + 1);
    if (!activeMessages) {
      activeMessages = new Set();
      activeRoundMessages.set(round + 1, activeMessages);
    }
    activeMessages.add(message.messageId);
    ledger.appendEvent(
      makeEvent("orchestrator:pass", {
        roundNumber: round,
        ...(orchestratorPassMetadata
          ? { metadata: orchestratorPassMetadata }
          : {}),
      }),
    );
    checkpoint.write({
      runId: manifest.runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: directive,
      ...(orchestratorPasses.length > 0
        ? { orchestratorPasses: [...orchestratorPasses] }
        : {}),
      checkpointedAt: new Date().toISOString(),
      startedAt: startedAtIso,
    });
    ledger.appendEvent(makeEvent("round:completed", { roundNumber: round }));

    return { directive };
  };

  const { emitter, run } = createRoundRunner({
    config,
    agents,
    backend,
    betweenRounds,
    schedulerPolicy: opts.schedulerPolicy,
    resolveBackend: opts.resolveBackend,
    resolveRuntime: opts.resolveRuntime,
    carryForwardDocPackets,
  });

  const uiMode: SwarmUiMode =
    opts.ui ?? (process.stderr.isTTY ? "live" : "quiet");
  let liveHandle: { destroy: () => void } | null = null;
  if (uiMode === "live") {
    liveHandle = attachLiveRenderer(emitter);
  } else if (uiMode === "quiet") {
    attachQuietLogger(emitter);
  }

  attachRoundLoopHandlers({
    emitter,
    config,
    runId: manifest.runId,
    seedBrief,
    startedAtIso,
    ledger,
    inbox,
    router,
    checkpoint,
    makeEvent,
    state: loopState,
    completedRoundPackets,
    completedRoundResults,
    orchestratorPasses,
    roundBriefs,
    activeRoundMessages,
    pendingRoundWrites,
  });

  try {
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run();
    } catch (err) {
      if (err instanceof OrchestratorDispatchError) {
        await Promise.all(pendingRoundWrites.values());
        ledger.appendEvent(
          makeEvent("run:failed", { metadata: { error: err.message } }),
        );
        await router.finalize(new Date().toISOString(), "failed");
        return 1;
      }
      throw err;
    }
    await Promise.all(pendingRoundWrites.values());

    if (result.ok) {
      const synthesis = buildOrchestratorSynthesis(manifest, result.rounds);
      await router.writeSynthesis(synthesis);
    }

    ledger.appendEvent(makeEvent(result.ok ? "run:completed" : "run:failed"));
    const finishedAt = new Date().toISOString();
    const finalStatus = result.ok ? "done" : "failed";
    await router.finalize(finishedAt, finalStatus);

    return result.ok ? 0 : 1;
  } finally {
    liveHandle?.destroy();
  }
}

/**
 * Resume an interrupted swarm run from its checkpoint.
 *
 * Reads the durable checkpoint and message ledger from `runDir`,
 * rehydrates in-memory state, and continues the round loop from the
 * first round that was not yet completed. The same runDir and runId
 * are reused so artifacts are appended to the existing run directory.
 *
 * Throws if no checkpoint exists in `runDir`.
 */
export async function resumeSwarm(opts: ResumeSwarmOpts): Promise<number> {
  const { config, agents, backend } = opts;
  const { runDir } = opts;

  const checkpointWriter = new CheckpointWriter(runDir);
  const savedCheckpoint = checkpointWriter.read();
  if (!savedCheckpoint) {
    throw new Error(`Cannot resume: no valid checkpoint found in ${runDir}`);
  }

  const {
    runId,
    lastCompletedRound,
    priorPacket,
    orchestratorDirective,
    startedAt,
  } = savedCheckpoint;
  const resumedFromRoundPackets =
    savedCheckpoint.completedRoundPackets &&
    savedCheckpoint.completedRoundPackets.length > 0
      ? savedCheckpoint.completedRoundPackets
      : [priorPacket];
  const resumedRoundResults =
    savedCheckpoint.completedRoundResults &&
    savedCheckpoint.completedRoundResults.length > 0
      ? restoreCheckpointRoundResults(savedCheckpoint.completedRoundResults)
      : roundPacketsToResults(resumedFromRoundPackets);

  const ledger = new LedgerWriter(runDir);
  const inbox = new InboxManager(ledger);
  inbox.rehydrate(ledger.readMessages());

  const manifest: RunManifest = {
    runId,
    status: "running",
    topic: config.topic,
    rounds: config.rounds,
    backend: config.backend,
    preset: config.preset,
    goal: config.goal,
    decision: config.decision,
    agents: config.agents,
    ...(opts.agentRuntimes ? { agentRuntimes: [...opts.agentRuntimes] } : {}),
    resolveMode: config.resolveMode,
    startedAt,
    runDir,
  };

  const carryForwardDocPackets = await loadCarryForwardDocSnapshots(runDir);
  const seedBrief = buildSeedBrief(config, carryForwardDocPackets);

  const writer = new ArtifactWriter({
    baseDir: runDir,
    manifest,
    seedBrief,
    wrapperName: backend.wrapperName ?? `${config.backend}-cli`,
    carryForwardDocPackets,
  });
  const checkpoint = checkpointWriter;
  const router = new OutputRouter([
    writer,
    ledger,
    ...(opts.additionalTargets ?? []),
  ]);

  // On resume: init only the ledger (idempotent append-only touch) and any
  // additional targets. ArtifactWriter.init() must NOT run — it would
  // overwrite the existing manifest.json and seed-brief.md.
  await ledger.init();
  for (const t of opts.additionalTargets ?? []) await t.init();

  const makeEvent = createRunEventFactory(manifest.runId);

  ledger.appendEvent(
    makeEvent("run:resumed", {
      metadata: { resumedFromRound: lastCompletedRound },
    }),
  );

  const roundBriefs = new Map<number, string>();
  const loopState: RoundLoopState = {
    priorPacket,
    orchestratorDirective,
  };
  const completedRoundPackets: RoundPacket[] = resumedRoundResults.map(
    (result) => result.packet,
  );
  const completedRoundResults: RoundResult[] = [...resumedRoundResults];
  const orchestratorPasses: OrchestratorPassRecord[] = [
    ...(savedCheckpoint.orchestratorPasses ?? []),
  ];
  const pendingRoundWrites = new Map<number, Promise<void>>();
  const startRound = lastCompletedRound + 1;
  const activeRoundMessages = new Map<number, Set<string>>();
  if (!savedCheckpoint.pendingBetweenRounds) {
    for (const recipient of inbox.stagedRecipients()) {
      for (const message of inbox.getStaged(recipient)) {
        if (
          message.roundNumber === startRound &&
          message.kind === "broadcast"
        ) {
          let activeMessages = activeRoundMessages.get(startRound);
          if (!activeMessages) {
            activeMessages = new Set();
            activeRoundMessages.set(startRound, activeMessages);
          }
          activeMessages.add(message.messageId);
        }
      }
    }
  }

  const awaitRoundWrite = async (round: number) => {
    const pending = pendingRoundWrites.get(round);
    if (pending) await pending;
  };

  const betweenRounds = async ({
    round,
    packet,
  }: {
    round: number;
    packet: RoundPacket;
  }) => {
    await awaitRoundWrite(round);

    checkpoint.write({
      runId: manifest.runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: loopState.orchestratorDirective,
      ...(orchestratorPasses.length > 0
        ? { orchestratorPasses: [...orchestratorPasses] }
        : {}),
      pendingBetweenRounds: true,
      checkpointedAt: new Date().toISOString(),
      startedAt,
    });

    let directive = buildOrchestratorPassDirective(packet);
    let orchestratorPassMetadata: RunEvent["metadata"] | undefined;
    if (
      config.resolveMode === "orchestrator" &&
      opts.orchestratorAgent !== undefined
    ) {
      const orchAgent = opts.orchestratorAgent;
      const orchBackend = opts.resolveBackend?.(orchAgent) ?? backend;
      const result = await dispatchOrchestratorPass({
        backend: orchBackend,
        agent: orchAgent,
        packet: packetWithPriorResolutionContext(packet, orchestratorPasses),
        goal: config.goal,
        decision: config.decision,
        nextRound: round + 1,
        timeoutMs: config.timeoutMs,
      });
      if (!result.ok) {
        throw new OrchestratorDispatchError(
          `Orchestrator dispatch failed: ${result.error}`,
        );
      }
      directive = result.output.directive;
      packet.questionResolutions = result.output.questionResolutions;
      packet.questionResolutionLimit = result.output.questionResolutionLimit;
      packet.deferredQuestions = result.output.deferredQuestions;
      orchestratorPasses.push({
        round,
        agentName: orchAgent.name,
        output: result.output,
      });
      orchestratorPassMetadata = {
        agentName: orchAgent.name,
        directive,
        confidence: result.output.confidence,
        questionResolutionsCount: result.output.questionResolutions.length,
        questionResolutionLimit: result.output.questionResolutionLimit,
        deferredQuestionsCount: result.output.deferredQuestions.length,
      };
    }
    loopState.orchestratorDirective = directive;

    const directiveRecipients = selectAgentsForRound(
      agents,
      round + 1,
      packet,
      opts.schedulerPolicy ?? "all",
    ).selected;
    const message: MessageEnvelope = {
      messageId: randomUUID(),
      senderId: "orchestrator",
      recipients: directiveRecipients,
      kind: "broadcast",
      payload: { directive, fromRound: round },
      deliveryStatus: "staged",
      createdAt: new Date().toISOString(),
      roundNumber: round + 1,
    };
    inbox.stage(message);
    let activeMessages = activeRoundMessages.get(round + 1);
    if (!activeMessages) {
      activeMessages = new Set();
      activeRoundMessages.set(round + 1, activeMessages);
    }
    activeMessages.add(message.messageId);
    ledger.appendEvent(
      makeEvent("orchestrator:pass", {
        roundNumber: round,
        ...(orchestratorPassMetadata
          ? { metadata: orchestratorPassMetadata }
          : {}),
      }),
    );
    checkpoint.write({
      runId: manifest.runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: directive,
      ...(orchestratorPasses.length > 0
        ? { orchestratorPasses: [...orchestratorPasses] }
        : {}),
      checkpointedAt: new Date().toISOString(),
      startedAt,
    });
    ledger.appendEvent(makeEvent("round:completed", { roundNumber: round }));

    return { directive };
  };

  if (savedCheckpoint.pendingBetweenRounds) {
    try {
      await betweenRounds({
        round: lastCompletedRound,
        packet: priorPacket,
      });
    } catch (err) {
      if (err instanceof OrchestratorDispatchError) {
        await Promise.all(pendingRoundWrites.values());
        ledger.appendEvent(
          makeEvent("run:failed", { metadata: { error: err.message } }),
        );
        await router.finalize(new Date().toISOString(), "failed");
        return 1;
      }
      throw err;
    }
  }

  const { emitter, run } = createRoundRunner({
    config,
    agents,
    backend,
    betweenRounds,
    schedulerPolicy: opts.schedulerPolicy,
    resolveBackend: opts.resolveBackend,
    resolveRuntime: opts.resolveRuntime,
    startRound,
    initialPriorPacket: priorPacket,
    initialOrchestratorDirective: loopState.orchestratorDirective,
    carryForwardDocPackets,
  });

  const uiMode: SwarmUiMode =
    opts.ui ?? (process.stderr.isTTY ? "live" : "quiet");
  let liveHandle: { destroy: () => void } | null = null;
  if (uiMode === "live") {
    liveHandle = attachLiveRenderer(emitter);
  } else if (uiMode === "quiet") {
    attachQuietLogger(emitter);
  }

  attachRoundLoopHandlers({
    emitter,
    config,
    runId: manifest.runId,
    seedBrief,
    startedAtIso: startedAt,
    ledger,
    inbox,
    router,
    checkpoint,
    makeEvent,
    state: loopState,
    completedRoundPackets,
    completedRoundResults,
    orchestratorPasses,
    roundBriefs,
    activeRoundMessages,
    pendingRoundWrites,
  });

  try {
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run();
    } catch (err) {
      if (err instanceof OrchestratorDispatchError) {
        await Promise.all(pendingRoundWrites.values());
        ledger.appendEvent(
          makeEvent("run:failed", { metadata: { error: err.message } }),
        );
        await router.finalize(new Date().toISOString(), "failed");
        return 1;
      }
      throw err;
    }
    await Promise.all(pendingRoundWrites.values());

    if (result.ok) {
      const synthesis = buildOrchestratorSynthesis(manifest, [
        ...resumedRoundResults,
        ...result.rounds,
      ]);
      await router.writeSynthesis(synthesis);
    }

    ledger.appendEvent(makeEvent(result.ok ? "run:completed" : "run:failed"));
    const finishedAt = new Date().toISOString();
    const finalStatus = result.ok ? "done" : "failed";
    await router.finalize(finishedAt, finalStatus);

    return result.ok ? 0 : 1;
  } finally {
    liveHandle?.destroy();
  }
}
