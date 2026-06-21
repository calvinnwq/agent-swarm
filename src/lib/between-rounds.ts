import { randomUUID } from "node:crypto";
import type {
  AgentDefinition,
  MessageEnvelope,
  OrchestratorPassRecord,
  RoundPacket,
  RunEvent,
} from "../schemas/index.js";
import type { BackendAdapter } from "../backends/index.js";
import type { SwarmRunConfig } from "./config.js";
import { buildOrchestratorPassDirective } from "./brief-generator.js";
import type { CheckpointWriter } from "./checkpoint-writer.js";
import type { InboxManager } from "./inbox-manager.js";
import type { LedgerWriter } from "./ledger-writer.js";
import { dispatchOrchestratorPass } from "./orchestrator-dispatcher.js";
import { packetWithPriorResolutionContext } from "./resolution-context.js";
import { checkpointRoundResults } from "./round-results.js";
import type { MakeRunEvent, RoundLoopState } from "./round-loop.js";
import type { BackendAdapterResolver, RoundResult } from "./round-runner.js";
import { selectAgentsForRound, type SchedulerPolicy } from "./scheduler.js";

/**
 * Raised when the orchestrator resolution pass fails mid-run. Both `runSwarm`
 * and `resumeSwarm` catch this to finalize the run as failed instead of
 * crashing the process, so it is owned here alongside the between-rounds pass
 * that throws it (and re-exported from `run-swarm.ts` for callers).
 */
export class OrchestratorDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorDispatchError";
  }
}

/**
 * Dependencies the between-rounds pass mutates or reads. The collections and
 * writers are shared by reference with the round-loop handlers; `state` carries
 * the directive forward into the next round's brief. The only per-entry-point
 * difference between fresh and resumed runs is `startedAtIso` (a fresh
 * `Date.toISOString()` vs. the timestamp restored from the checkpoint).
 */
export interface BetweenRoundsDeps {
  config: SwarmRunConfig;
  agents: AgentDefinition[];
  backend: BackendAdapter;
  runId: string;
  startedAtIso: string;
  ledger: LedgerWriter;
  inbox: InboxManager;
  checkpoint: CheckpointWriter;
  makeEvent: MakeRunEvent;
  state: RoundLoopState;
  completedRoundPackets: RoundPacket[];
  completedRoundResults: RoundResult[];
  orchestratorPasses: OrchestratorPassRecord[];
  activeRoundMessages: Map<number, Set<string>>;
  pendingRoundWrites: Map<number, Promise<void>>;
  orchestratorAgent?: AgentDefinition;
  resolveBackend?: BackendAdapterResolver;
  schedulerPolicy?: SchedulerPolicy;
}

/** The between-rounds callback handed to the round runner. */
export type BetweenRoundsFn = (args: {
  round: number;
  packet: RoundPacket;
}) => Promise<{ directive: string }>;

/**
 * Build the shared between-rounds pass run after each completed round.
 *
 * It awaits the round's pending artifact write, records a
 * `pendingBetweenRounds` checkpoint, derives the next-round directive
 * (deterministic, or via the orchestrator dispatch when
 * `config.resolveMode === "orchestrator"` and an `orchestratorAgent` is
 * supplied), stages the broadcast directive message for the next round's
 * recipients, appends the `orchestrator:pass` / `round:completed` ledger
 * events, and writes the finalized checkpoint. Mutates `state`, the supplied
 * collections, and the writers in place — identical for fresh and resumed runs.
 *
 * @throws {OrchestratorDispatchError} when the orchestrator dispatch fails.
 */
export function createBetweenRounds(deps: BetweenRoundsDeps): BetweenRoundsFn {
  const {
    config,
    agents,
    backend,
    runId,
    startedAtIso,
    ledger,
    inbox,
    checkpoint,
    makeEvent,
    state,
    completedRoundPackets,
    completedRoundResults,
    orchestratorPasses,
    activeRoundMessages,
    pendingRoundWrites,
    orchestratorAgent,
    resolveBackend,
    schedulerPolicy,
  } = deps;

  const awaitRoundWrite = async (round: number) => {
    const pending = pendingRoundWrites.get(round);
    if (pending) await pending;
  };

  return async ({ round, packet }) => {
    await awaitRoundWrite(round);

    checkpoint.write({
      runId,
      lastCompletedRound: round,
      priorPacket: packet,
      completedRoundPackets: [...completedRoundPackets],
      completedRoundResults: checkpointRoundResults(completedRoundResults),
      orchestratorDirective: state.orchestratorDirective,
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
      orchestratorAgent !== undefined
    ) {
      const orchAgent = orchestratorAgent;
      const orchBackend = resolveBackend?.(orchAgent) ?? backend;
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
    state.orchestratorDirective = directive;

    const directiveRecipients = selectAgentsForRound(
      agents,
      round + 1,
      packet,
      schedulerPolicy ?? "all",
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
      runId,
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
}
