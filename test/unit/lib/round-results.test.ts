import { describe, it, expect } from "vitest";
import {
  didRoundSucceed,
  roundPacketsToResults,
  checkpointRoundResults,
  restoreCheckpointRoundResults,
} from "../../../src/lib/round-results.js";
import type { AgentOutput, RoundPacket } from "../../../src/schemas/index.js";
import type { AgentResult } from "../../../src/lib/round-runner.js";

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
      durationMs: 1000,
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

describe("didRoundSucceed", () => {
  it("succeeds when at least two agent results are ok", () => {
    const results = [
      makeAgentResult({ agent: "a", ok: true }),
      makeAgentResult({ agent: "b", ok: true }),
    ];
    expect(didRoundSucceed(results)).toBe(true);
  });

  it("fails when fewer than two agent results are ok", () => {
    const results = [
      makeAgentResult({ agent: "a", ok: true }),
      makeAgentResult({ agent: "b", ok: false }),
    ];
    expect(didRoundSucceed(results)).toBe(false);
  });

  it("fails on an empty round", () => {
    expect(didRoundSucceed([])).toBe(false);
  });
});

describe("roundPacketsToResults", () => {
  it("preserves a numeric packet round and empties agent results", () => {
    const packet = makeRoundPacket(2);
    const [result] = roundPacketsToResults([packet]);
    expect(result.round).toBe(2);
    expect(result.agentResults).toEqual([]);
    expect(result.packet).toBe(packet);
  });

  it("falls back to a 1-based index when packet round is null", () => {
    const results = roundPacketsToResults([
      makeRoundPacket(null),
      makeRoundPacket(null),
    ]);
    expect(results.map((r) => r.round)).toEqual([1, 2]);
  });
});

describe("checkpoint round-result serialization", () => {
  it("projects agent results down to the checkpoint shape", () => {
    const packet = makeRoundPacket(1);
    const roundResult = {
      round: 1,
      packet,
      agentResults: [makeAgentResult({ agent: "alpha", error: null })],
    };
    const [checkpointed] = checkpointRoundResults([roundResult]);
    expect(checkpointed.round).toBe(1);
    expect(checkpointed.packet).toBe(packet);
    expect(checkpointed.agentResults[0]).toEqual({
      agent: "alpha",
      ok: true,
      output: roundResult.agentResults[0].output,
      error: null,
    });
    // raw and runtime are dropped from the durable checkpoint shape.
    expect("raw" in checkpointed.agentResults[0]).toBe(false);
  });

  it("round-trips back into round results with raw reset to null", () => {
    const packet = makeRoundPacket(1);
    const roundResult = {
      round: 1,
      packet,
      agentResults: [makeAgentResult({ agent: "alpha" })],
    };
    const checkpointed = checkpointRoundResults([roundResult]);
    const [restored] = restoreCheckpointRoundResults(checkpointed);
    expect(restored.round).toBe(1);
    expect(restored.packet).toBe(packet);
    expect(restored.agentResults[0]).toEqual({
      agent: "alpha",
      ok: true,
      output: roundResult.agentResults[0].output,
      error: null,
      raw: null,
    });
  });
});
