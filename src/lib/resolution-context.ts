import type {
  OrchestratorPassRecord,
  QuestionResolution,
  RoundPacket,
} from "../schemas/index.js";

/**
 * Between-round question-resolution context: folds the resolutions, deferred
 * questions, and resolution limit accumulated across prior orchestrator passes
 * into the packet handed to the next pass. Pure and side-effect free.
 */

function addUniqueStrings(target: string[], values: readonly string[]): void {
  const seen = new Set(target);
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
}

function addUniqueQuestionResolutions(
  target: QuestionResolution[],
  values: readonly QuestionResolution[],
): void {
  const seen = new Set(target.map((resolution) => resolution.question));
  for (const resolution of values) {
    if (seen.has(resolution.question)) continue;
    seen.add(resolution.question);
    target.push(resolution);
  }
}

/**
 * Merge the resolution context carried by prior orchestrator passes into
 * `packet`, deduping resolutions by question and deferred questions by value
 * (prior-pass entries win over the packet's). When the packet carries no
 * positive resolution limit, derive one from the largest prior-pass limit.
 * Returns the packet unchanged when there are no prior passes.
 */
export function packetWithPriorResolutionContext(
  packet: RoundPacket,
  orchestratorPasses: readonly OrchestratorPassRecord[],
): RoundPacket {
  if (orchestratorPasses.length === 0) return packet;

  const questionResolutions: QuestionResolution[] = [];
  const deferredQuestions: string[] = [];

  for (const pass of orchestratorPasses) {
    addUniqueQuestionResolutions(
      questionResolutions,
      pass.output.questionResolutions,
    );
    addUniqueStrings(deferredQuestions, pass.output.deferredQuestions);
  }
  addUniqueQuestionResolutions(questionResolutions, packet.questionResolutions);
  addUniqueStrings(deferredQuestions, packet.deferredQuestions);

  return {
    ...packet,
    questionResolutions,
    deferredQuestions,
    questionResolutionLimit:
      packet.questionResolutionLimit > 0
        ? packet.questionResolutionLimit
        : Math.max(
            0,
            ...orchestratorPasses.map(
              (pass) => pass.output.questionResolutionLimit,
            ),
          ),
  };
}
