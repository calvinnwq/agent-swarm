import type { RoundPacket, RunCheckpoint } from "../schemas/index.js";
import type { RoundResult } from "./round-runner.js";

/**
 * Round-result mapping helpers for the run pipeline: success predicate plus the
 * serialization seam between live {@link RoundResult}s and the durable
 * checkpoint shape persisted in `checkpoint.json`. Pure and side-effect free so
 * both `runSwarm` and `resumeSwarm` can share one definition.
 */

/** A round succeeds once at least two agents return ok results. */
export function didRoundSucceed(
  agentResults: RoundResult["agentResults"],
): boolean {
  return agentResults.filter((r) => r.ok).length >= 2;
}

/**
 * Rehydrate bare round packets (no per-agent results) into {@link RoundResult}s,
 * defaulting the round number to a 1-based index when the packet omits it.
 */
export function roundPacketsToResults(packets: RoundPacket[]): RoundResult[] {
  return packets.map((packet, index) => ({
    round: typeof packet.round === "number" ? packet.round : index + 1,
    agentResults: [],
    packet,
  }));
}

/**
 * Project live round results down to the durable checkpoint shape, dropping the
 * non-serialized `raw` response and resolved `runtime` from each agent result.
 */
export function checkpointRoundResults(roundResults: RoundResult[]) {
  return roundResults.map(({ round, agentResults, packet }) => ({
    round,
    packet,
    agentResults: agentResults.map(({ agent, ok, output, error }) => ({
      agent,
      ok,
      output,
      error,
    })),
  }));
}

/**
 * Inverse of {@link checkpointRoundResults}: restore checkpointed round results
 * into in-memory {@link RoundResult}s, resetting the absent `raw` response to
 * null.
 */
export function restoreCheckpointRoundResults(
  checkpointResults: NonNullable<RunCheckpoint["completedRoundResults"]>,
): RoundResult[] {
  return checkpointResults.map(({ round, agentResults, packet }) => ({
    round,
    packet,
    agentResults: agentResults.map(({ agent, ok, output, error }) => ({
      agent,
      ok,
      output,
      error,
      raw: null,
    })),
  }));
}
