import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import type {
  MessageEnvelope,
  OrchestratorPassRecord,
  RoundPacket,
  RunEvent,
} from "../schemas/index.js";
import type { SwarmRunConfig } from "./config.js";
import { buildRoundBrief } from "./brief-generator.js";
import type { CheckpointWriter } from "./checkpoint-writer.js";
import type { InboxManager } from "./inbox-manager.js";
import type { LedgerWriter } from "./ledger-writer.js";
import type { OutputRouter } from "./output-router.js";
import { checkpointRoundResults, didRoundSucceed } from "./round-results.js";
import type { RoundResult } from "./round-runner.js";
import type { SchedulerDecision } from "./scheduler.js";

/**
 * Shared round-loop wiring for the run pipeline. Both `runSwarm` and
 * `resumeSwarm` stage briefs, commit inbox messages, append ledger events, and
 * write artifacts/checkpoints in response to the round runner's emitter in the
 * exact same way — the only per-call differences are the run id, the run start
 * timestamp, and the small mutable cross-round state ({@link RoundLoopState}).
 * Extracting that wiring here keeps the two entry points from drifting.
 */

/** Factory producing run-scoped {@link RunEvent}s with fresh ids + timestamps. */
export type MakeRunEvent = (
  kind: RunEvent["kind"],
  extra?: Pick<RunEvent, "roundNumber" | "agentName" | "metadata">,
) => RunEvent;

/** Build a {@link MakeRunEvent} bound to a single run's id. */
export function createRunEventFactory(runId: string): MakeRunEvent {
  return (kind, extra) => ({
    eventId: randomUUID(),
    kind,
    runId,
    occurredAt: new Date().toISOString(),
    ...extra,
  });
}

/**
 * Mutable cross-round state reassigned during the loop. `priorPacket` and
 * `orchestratorDirective` are read by the round-start brief builder and the
 * round-done checkpoint, and written by `round:done` / the between-rounds pass,
 * so they are shared by reference rather than captured per closure.
 */
export interface RoundLoopState {
  priorPacket: RoundPacket | null;
  orchestratorDirective: string | undefined;
}

export interface RoundLoopWiringOpts {
  emitter: EventEmitter;
  config: SwarmRunConfig;
  runId: string;
  seedBrief: string;
  startedAtIso: string;
  ledger: LedgerWriter;
  inbox: InboxManager;
  router: OutputRouter;
  checkpoint: CheckpointWriter;
  makeEvent: MakeRunEvent;
  state: RoundLoopState;
  completedRoundPackets: RoundPacket[];
  completedRoundResults: RoundResult[];
  orchestratorPasses: OrchestratorPassRecord[];
  roundBriefs: Map<number, string>;
  activeRoundMessages: Map<number, Set<string>>;
  pendingRoundWrites: Map<number, Promise<void>>;
}

/**
 * Subscribe the shared round-lifecycle handlers to `emitter`:
 *
 * - `round:start` — build + record the round brief, append the scheduler and
 *   round-started ledger events, and stage one task message per agent.
 * - `agent:start` — commit the agent's staged messages and append `agent:started`.
 * - `agent:ok` / `agent:fail` — append the matching agent ledger event.
 * - `round:done` — write the round artifact, and on a successful round advance
 *   the cross-round state, recording the terminal-round checkpoint + ledger event.
 *
 * Mutates `state`, the supplied collections, and the writers in place. Identical
 * for fresh and resumed runs.
 */
export function attachRoundLoopHandlers(opts: RoundLoopWiringOpts): void {
  const {
    emitter,
    config,
    runId,
    seedBrief,
    startedAtIso,
    ledger,
    inbox,
    router,
    checkpoint,
    makeEvent,
    state,
    completedRoundPackets,
    completedRoundResults,
    orchestratorPasses,
    roundBriefs,
    activeRoundMessages,
    pendingRoundWrites,
  } = opts;

  emitter.on(
    "round:start",
    ({
      round,
      agents: agentNames,
      schedulerDecision,
    }: {
      round: number;
      agents: string[];
      schedulerDecision: SchedulerDecision;
    }) => {
      const brief =
        round === 1
          ? seedBrief
          : buildRoundBrief({
              config,
              round,
              seedBrief,
              priorPacket: state.priorPacket,
              orchestratorDirective: state.orchestratorDirective,
            });
      roundBriefs.set(round, brief);
      ledger.appendEvent(
        makeEvent("scheduler:decision", {
          roundNumber: round,
          metadata: {
            policy: schedulerDecision.policy,
            selected: schedulerDecision.selected,
            reason: schedulerDecision.reason,
          },
        }),
      );
      ledger.appendEvent(makeEvent("round:started", { roundNumber: round }));
      for (const agentName of agentNames) {
        const message: MessageEnvelope = {
          messageId: randomUUID(),
          senderId: "orchestrator",
          recipients: [agentName],
          kind: "task",
          payload: { brief, round },
          deliveryStatus: "staged",
          createdAt: new Date().toISOString(),
          roundNumber: round,
        };
        inbox.stage(message);
        let activeMessages = activeRoundMessages.get(round);
        if (!activeMessages) {
          activeMessages = new Set();
          activeRoundMessages.set(round, activeMessages);
        }
        activeMessages.add(message.messageId);
      }
    },
  );

  emitter.on(
    "agent:start",
    ({ round, agent }: { round: number; agent: string }) => {
      const activeMessages = activeRoundMessages.get(round);
      inbox.commit(
        agent,
        (message) => activeMessages?.has(message.messageId) ?? false,
      );
      ledger.appendEvent(
        makeEvent("agent:started", { roundNumber: round, agentName: agent }),
      );
    },
  );

  emitter.on(
    "agent:ok",
    ({ round, agent }: { round: number; agent: string }) => {
      ledger.appendEvent(
        makeEvent("agent:completed", { roundNumber: round, agentName: agent }),
      );
    },
  );

  emitter.on(
    "agent:fail",
    ({ round, agent }: { round: number; agent: string }) => {
      ledger.appendEvent(
        makeEvent("agent:failed", { roundNumber: round, agentName: agent }),
      );
    },
  );

  emitter.on(
    "round:done",
    ({
      round,
      packet,
      agentResults,
    }: {
      round: number;
      packet: RoundPacket;
      agentResults: RoundResult["agentResults"];
    }) => {
      const brief = roundBriefs.get(round) ?? "";
      const roundResult: RoundResult = { round, agentResults, packet };
      const pending = router.writeRound(roundResult, brief).then(() => {
        if (!didRoundSucceed(agentResults)) return;

        state.priorPacket = packet;
        completedRoundPackets.push(packet);
        completedRoundResults.push(roundResult);
        if (round < config.rounds) return;

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
          checkpointedAt: new Date().toISOString(),
          startedAt: startedAtIso,
        });
        ledger.appendEvent(
          makeEvent("round:completed", { roundNumber: round }),
        );
      });
      pendingRoundWrites.set(round, pending);
    },
  );
}
