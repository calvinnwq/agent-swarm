import process from "node:process";
import { Command, InvalidArgumentError } from "commander";
import {
  buildHarnessAdapterRegistry,
  createAgentAdapterResolver,
  createAgentRuntimeResolver,
  createBackendAdapter,
} from "../backends/index.js";
import type { AgentDefinition, HarnessId } from "../schemas/index.js";
import { loadAgentRegistry } from "./agent-registry.js";
import type { AgentSelectionSource } from "./config.js";
import { resolveCarryForwardDocs } from "./doc-inputs.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import {
  assertResolvedRuntimesAvailable,
  backendToHarness,
  resolveAgentRuntimes,
} from "./harness-resolution.js";
import { CLI_NAME } from "./identity.js";
import { formatInitResult, initProjectConfig } from "./init-config.js";
import { loadProjectConfig } from "./load-project-config.js";
import { buildConfig, SwarmCommandError } from "./parse-command.js";
import { loadPresetRegistry, resolvePresetByName } from "./preset-registry.js";
import { runSwarm } from "./run-swarm.js";

function collectDoc(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseRoundsArg(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new InvalidArgumentError("rounds must be an integer");
  }
  return parsed;
}

function resolveOrchestratorAgent(
  orchestratorAgent: AgentDefinition,
  agents: readonly AgentDefinition[],
  hasRunBackendOverride: boolean,
): AgentDefinition {
  if (hasRunBackendOverride || orchestratorAgent.harness !== undefined) {
    return orchestratorAgent;
  }

  const explicitHarnesses = new Set<HarnessId>();
  for (const agent of agents) {
    explicitHarnesses.add(agent.harness ?? backendToHarness(agent.backend));
  }

  if (explicitHarnesses.size !== 1) {
    return orchestratorAgent;
  }

  const [harness] = explicitHarnesses;
  return { ...orchestratorAgent, harness };
}

/**
 * Build the Commander program: register the run/init/doctor commands and wire
 * each to its src/lib handler. Constructing the program neither parses argv nor
 * exits the process, so the command surface stays inspectable in tests.
 */
export function buildCliProgram(version: string): Command {
  const program = new Command();

  program
    .name(CLI_NAME)
    .description(
      "Fan out agents in parallel rounds, collect structured output, synthesize.",
    )
    .version(version);

  program
    .command("run", { isDefault: true })
    .description("Run a swarm")
    .argument("<rounds>", "number of rounds (1–3)", parseRoundsArg)
    .argument("<topic...>", "topic for the swarm")
    .option("--agents <list>", "comma-separated agent names")
    .option(
      "--resolve <mode>",
      "between-round resolution mode: off | orchestrator | agents. orchestrator runs an LLM-driven pass that updates question resolutions and the next-round directive; off uses the deterministic directive only; agents is reserved.",
    )
    .option("--goal <text>", "primary goal for the swarm")
    .option("--decision <text>", "decision target for the swarm")
    .option(
      "--doc <path>",
      "carry-forward document (repeatable)",
      collectDoc,
      [],
    )
    .option(
      "--preset <name>",
      "named preset (resolves to agents when --agents not provided)",
    )
    .option(
      "--backend <name>",
      "runtime backend adapter (currently: claude, codex)",
    )
    .option(
      "--timeout-ms <ms>",
      "per-agent and orchestrator dispatch timeout in milliseconds (default: 120000)",
    )
    .option(
      "--quiet",
      "force quiet (one-line-per-event) output; default auto by TTY",
    )
    .action(
      async (
        rounds: number,
        topic: string[],
        options: Record<string, unknown>,
      ) => {
        try {
          const loadedProjectConfig = await loadProjectConfig();
          const projectConfig = loadedProjectConfig?.config ?? {};
          const cliDocs = options.doc as string[] | undefined;
          const cliAgents = options.agents as string | undefined;
          const configAgents = projectConfig.agents?.join(",");
          const cliPresetName = options.preset as string | undefined;
          const configPresetName = projectConfig.preset;
          const cliBackend = options.backend as string | undefined;
          const configBackend = projectConfig.backend;
          const cliTimeoutMs = options.timeoutMs as string | undefined;
          const configTimeoutMs = projectConfig.timeoutMs;

          let resolvedAgents: string | undefined = cliAgents;
          const resolvedBackend = cliBackend ?? configBackend;
          const resolvedTimeoutMs = cliTimeoutMs ?? configTimeoutMs;
          let resolvedResolve =
            (options.resolve as string | undefined) ?? projectConfig.resolve;
          let resolvedGoal =
            (options.goal as string | undefined) ?? projectConfig.goal;
          let resolvedDecision =
            (options.decision as string | undefined) ?? projectConfig.decision;
          let resolvedPresetName: string | undefined;
          let selectionSource: AgentSelectionSource | undefined;

          if (cliAgents === undefined && cliPresetName !== undefined) {
            const preset = await resolvePresetByName(cliPresetName);
            resolvedAgents = preset.agents.join(",");
            resolvedPresetName = cliPresetName;
            selectionSource = "preset";
            resolvedResolve = resolvedResolve ?? preset.resolve;
            resolvedGoal = resolvedGoal ?? preset.goal;
            resolvedDecision = resolvedDecision ?? preset.decision;
          } else if (
            resolvedAgents === undefined &&
            configAgents !== undefined
          ) {
            resolvedAgents = configAgents;
          } else if (
            resolvedAgents === undefined &&
            configPresetName !== undefined
          ) {
            const presetRegistry = await loadPresetRegistry();
            const preset = presetRegistry.getPreset(configPresetName);
            resolvedAgents = preset.agents.join(",");
            resolvedPresetName = configPresetName;
            selectionSource = "preset";
            resolvedResolve = resolvedResolve ?? preset.resolve;
            resolvedGoal = resolvedGoal ?? preset.goal;
            resolvedDecision = resolvedDecision ?? preset.decision;
          }

          const selectedDocs =
            cliDocs && cliDocs.length > 0
              ? cliDocs
              : (projectConfig.docs ?? []);
          const resolvedDocs = await resolveCarryForwardDocs(selectedDocs);

          const config = buildConfig({
            rounds,
            topic,
            agents: resolvedAgents,
            backend: resolvedBackend,
            resolve: resolvedResolve,
            timeoutMs: resolvedTimeoutMs,
            goal: resolvedGoal,
            decision: resolvedDecision,
            docs: resolvedDocs,
            preset: resolvedPresetName,
            selectionSource,
            commandText: process.argv.slice(2).join(" "),
          });
          const registry = await loadAgentRegistry();
          const agents = config.agents.map((name) => registry.getAgent(name));
          const rawOrchestratorAgent =
            config.resolveMode === "orchestrator"
              ? registry.getAgent("orchestrator")
              : undefined;
          const runtimeBackend =
            resolvedBackend === undefined ? undefined : config.backend;
          const orchestratorAgent = rawOrchestratorAgent
            ? resolveOrchestratorAgent(
                rawOrchestratorAgent,
                agents,
                runtimeBackend !== undefined,
              )
            : undefined;
          const resolutionTargets = orchestratorAgent
            ? [...agents, orchestratorAgent]
            : agents;
          const resolved = resolveAgentRuntimes(
            resolutionTargets,
            runtimeBackend,
          );
          assertResolvedRuntimesAvailable(resolved);
          const harnessRegistry = buildHarnessAdapterRegistry(resolved);
          const resolveBackend = createAgentAdapterResolver(
            resolved,
            harnessRegistry,
          );
          const resolveRuntime = createAgentRuntimeResolver(resolved);
          const backend = createBackendAdapter(config.backend);
          const ui = options.quiet === true ? "quiet" : undefined;
          const exitCode = await runSwarm({
            config,
            agents,
            backend,
            ui,
            resolveBackend,
            resolveRuntime,
            agentRuntimes: resolved,
            orchestratorAgent,
          });
          process.exit(exitCode);
        } catch (err) {
          if (err instanceof SwarmCommandError) {
            process.stderr.write(`${CLI_NAME}: ${err.message}\n`);
            process.exit(2);
          }
          throw err;
        }
      },
    );

  program
    .command("init")
    .description(
      "Create .agent-swarm/config.yml with minimal safe defaults (CLI flags override config)",
    )
    .option("--force", "overwrite an existing .agent-swarm/config.yml")
    .action(async (options: Record<string, unknown>) => {
      try {
        const result = await initProjectConfig({
          force: options.force === true,
        });
        process.stdout.write(`${formatInitResult(result)}\n`);
        process.exit(0);
      } catch (err) {
        if (err instanceof SwarmCommandError) {
          process.stderr.write(`${CLI_NAME}: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
    });

  program
    .command("doctor")
    .description(
      "Diagnose swarm setup: config, agents, presets, and harness capability",
    )
    .action(async () => {
      try {
        const report = await runDoctor();
        process.stdout.write(`${formatDoctorReport(report)}\n`);
        process.exit(report.ok ? 0 : 1);
      } catch (err) {
        if (err instanceof SwarmCommandError) {
          process.stderr.write(`${CLI_NAME}: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
    });

  return program;
}

/**
 * Parse argv and dispatch the matching command. Mirrors the previous top-level
 * behavior in src/cli.ts: a Commander/parse failure that escapes the per-command
 * handlers is reported with the CLI name and exits with code 1.
 */
export async function runCli(version: string): Promise<void> {
  const program = buildCliProgram(version);

  // NGX-501: a true zero-argument invocation shows top-level help and exits 0
  // instead of falling through to the default run command, which would fail
  // with "missing required argument 'rounds'". Any non-empty argv (including
  // the `run` shorthand) still dispatches through Commander as before.
  if (process.argv.slice(2).length === 0) {
    program.outputHelp();
    process.exit(0);
  }

  try {
    await program.parseAsync();
  } catch (err) {
    process.stderr.write(
      `\n  ${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}\n\n`,
    );
    process.exit(1);
  }
}
