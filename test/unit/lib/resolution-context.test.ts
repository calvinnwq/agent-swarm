import { describe, it, expect } from "vitest";
import { packetWithPriorResolutionContext } from "../../../src/lib/resolution-context.js";
import type {
  OrchestratorPassRecord,
  QuestionResolution,
  RoundPacket,
} from "../../../src/schemas/index.js";

function makeResolution(
  question: string,
  overrides: Partial<QuestionResolution> = {},
): QuestionResolution {
  return {
    question,
    status: "consensus",
    answer: "yes",
    basis: "shared",
    confidence: "high",
    askedBy: [],
    supportingAgents: [],
    supportingReasoning: [],
    relatedObjections: [],
    relatedRisks: [],
    blockingScore: 0,
    ...overrides,
  };
}

function makeRoundPacket(overrides: Partial<RoundPacket> = {}): RoundPacket {
  return {
    round: 2,
    agents: [],
    summaries: [],
    keyObjections: [],
    sharedRisks: [],
    openQuestions: [],
    questionResolutions: [],
    questionResolutionLimit: 0,
    deferredQuestions: [],
    ...overrides,
  };
}

function makePass(
  round: number,
  output: {
    questionResolutions?: QuestionResolution[];
    deferredQuestions?: string[];
    questionResolutionLimit?: number;
  },
): OrchestratorPassRecord {
  return {
    round,
    agentName: "orchestrator",
    output: {
      round,
      directive: "continue",
      questionResolutions: output.questionResolutions ?? [],
      questionResolutionLimit: output.questionResolutionLimit ?? 0,
      deferredQuestions: output.deferredQuestions ?? [],
      confidence: "high",
    },
  };
}

describe("packetWithPriorResolutionContext", () => {
  it("returns the packet unchanged when there are no prior passes", () => {
    const packet = makeRoundPacket();
    expect(packetWithPriorResolutionContext(packet, [])).toBe(packet);
  });

  it("merges prior-pass resolutions ahead of packet resolutions and dedupes by question", () => {
    const packet = makeRoundPacket({
      questionResolutions: [
        makeResolution("Q1", { answer: "from-packet" }),
        makeResolution("Q2"),
      ],
    });
    const passes = [
      makePass(1, {
        questionResolutions: [makeResolution("Q1", { answer: "from-pass" })],
      }),
    ];

    const merged = packetWithPriorResolutionContext(packet, passes);

    expect(merged.questionResolutions.map((r) => r.question)).toEqual([
      "Q1",
      "Q2",
    ]);
    // First write wins: the prior pass resolution is kept over the packet's.
    expect(merged.questionResolutions[0].answer).toBe("from-pass");
  });

  it("merges and dedupes deferred questions across passes and the packet", () => {
    const packet = makeRoundPacket({ deferredQuestions: ["D2", "D1"] });
    const passes = [makePass(1, { deferredQuestions: ["D1"] })];

    const merged = packetWithPriorResolutionContext(packet, passes);

    expect(merged.deferredQuestions).toEqual(["D1", "D2"]);
  });

  it("keeps a positive packet resolution limit", () => {
    const packet = makeRoundPacket({ questionResolutionLimit: 5 });
    const passes = [makePass(1, { questionResolutionLimit: 9 })];

    const merged = packetWithPriorResolutionContext(packet, passes);

    expect(merged.questionResolutionLimit).toBe(5);
  });

  it("derives the resolution limit from the max prior pass when the packet limit is zero", () => {
    const packet = makeRoundPacket({ questionResolutionLimit: 0 });
    const passes = [
      makePass(1, { questionResolutionLimit: 3 }),
      makePass(2, { questionResolutionLimit: 7 }),
    ];

    const merged = packetWithPriorResolutionContext(packet, passes);

    expect(merged.questionResolutionLimit).toBe(7);
  });
});
