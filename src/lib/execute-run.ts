import type { RunManifest } from "../schemas/index.js";
import { attachLiveRenderer, attachQuietLogger } from "../ui/index.js";
import { OrchestratorDispatchError } from "./between-rounds.js";
import {
  attachRoundLoopHandlers,
  type RoundLoopWiringOpts,
} from "./round-loop.js";
import type { RoundResult, RunResult } from "./round-runner.js";
import { buildOrchestratorSynthesis } from "./synthesis.js";

/**
 * Terminal output mode for a run. "live" attaches the cell-diff renderer,
 * "quiet" the one-line-per-event logger, and "silent" attaches neither (the
 * artifacts are still written).
 */
export type SwarmUiMode = "live" | "quiet" | "silent";

/**
 * Dependencies for the shared run-execution tail. It is a superset of the
 * round-loop wiring ({@link RoundLoopWiringOpts}) plus the round runner's
 * `run`, the resolved UI `uiMode`, the `manifest` synthesis is built from, and
 * the `priorRoundResults` already completed before this leg of the run (empty
 * for a fresh run, the rehydrated rounds for a resume).
 */
export interface ExecuteRunDeps extends RoundLoopWiringOpts {
  run: () => Promise<RunResult>;
  uiMode: SwarmUiMode;
  manifest: RunManifest;
  priorRoundResults: readonly RoundResult[];
}

/**
 * Attach the UI + round-loop handlers, drive the round runner to completion,
 * and finalize the run. Identical for `runSwarm` and `resumeSwarm` — the only
 * per-entry-point difference is `priorRoundResults`, which is prepended to the
 * round runner's rounds when building the deterministic synthesis (empty for a
 * fresh run, so the synthesis input is just `result.rounds`).
 *
 * The renderer is attached before the round-loop handlers to preserve emitter
 * listener-registration order, and is destroyed in a `finally` so it is torn
 * down on every exit path. Returns the process exit code (0 success, 1 failure).
 *
 * An {@link OrchestratorDispatchError} escaping the round runner finalizes the
 * run as failed (exit 1) rather than crashing; any other error propagates.
 */
export async function executeRun(deps: ExecuteRunDeps): Promise<number> {
  const {
    emitter,
    run,
    uiMode,
    manifest,
    priorRoundResults,
    ledger,
    router,
    makeEvent,
    pendingRoundWrites,
  } = deps;

  let liveHandle: { destroy: () => void } | null = null;
  if (uiMode === "live") {
    liveHandle = attachLiveRenderer(emitter);
  } else if (uiMode === "quiet") {
    attachQuietLogger(emitter);
  }

  attachRoundLoopHandlers(deps);

  try {
    let result: RunResult;
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
        ...priorRoundResults,
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
