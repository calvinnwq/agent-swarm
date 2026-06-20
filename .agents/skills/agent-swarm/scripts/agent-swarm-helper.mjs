import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RESOLVE_MODES = new Set(["off", "orchestrator", "agents"]);

export function shellQuote(value) {
  if (value === "") {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildRunCommand(options) {
  const question = requireText(options.question, "--question");
  const preset = requireText(options.preset, "--preset");
  const rounds = parsePositiveInt(options.rounds ?? "1", "--rounds");
  const timeoutMs = parsePositiveInt(
    options.timeoutMs ?? "600000",
    "--timeout-ms",
  );
  const resolve = options.resolve ?? "off";
  if (!RESOLVE_MODES.has(resolve)) {
    throw new Error("--resolve must be one of: off, orchestrator, agents");
  }

  const cliTokens =
    options.builtCli === true
      ? ["node", "../dist/cli.mjs"]
      : ["npx", "-y", "@calvinnwq/agent-swarm"];
  const goal = options.goal ?? `Help answer: ${question}`;
  const docs = options.docs ?? [];
  const tokens = [
    ...cliTokens,
    "run",
    String(rounds),
    question,
    "--preset",
    preset,
    "--goal",
    goal,
    "--resolve",
    resolve,
    "--timeout-ms",
    String(timeoutMs),
    "--quiet",
  ];

  if (options.decision) {
    tokens.push("--decision", options.decision);
  }
  for (const doc of docs) {
    tokens.push("--doc", doc);
  }

  return {
    argv: tokens,
    command: tokens.map(shellQuote).join(" "),
  };
}

export async function inspectLatestRun(projectDir = process.cwd()) {
  const runsDir = path.join(projectDir, ".agent-swarm", "runs");
  let entries;
  try {
    entries = await readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`No Agent Swarm runs directory found at ${runsDir}`);
  }

  const runDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fullPath = path.join(runsDir, entry.name);
    runDirs.push({ name: entry.name, path: fullPath, stat: await stat(fullPath) });
  }
  if (runDirs.length === 0) {
    throw new Error(`No Agent Swarm run directories found at ${runsDir}`);
  }

  runDirs.sort((a, b) => {
    const byTime = b.stat.mtimeMs - a.stat.mtimeMs;
    return byTime || b.name.localeCompare(a.name);
  });

  const runDir = runDirs[0].path;
  const manifestPath = path.join(runDir, "manifest.json");
  const synthesisPath = path.join(runDir, "synthesis.md");
  const manifest = await readJsonIfPresent(manifestPath);
  const synthesis = await readTextIfPresent(synthesisPath);

  return {
    runDir,
    manifestPath,
    synthesisPath,
    topic: manifest?.topic ?? null,
    status: manifest?.status ?? null,
    preset: manifest?.preset ?? null,
    agents: Array.isArray(manifest?.agents) ? manifest.agents : [],
    agentRuntimes: Array.isArray(manifest?.agentRuntimes)
      ? manifest.agentRuntimes
      : [],
    hasSynthesis: synthesis !== null,
    synthesisPreview: synthesis ? preview(synthesis) : null,
  };
}

export function formatRunReport(result) {
  const lines = [
    `Run: ${result.runDir}`,
    `Status: ${result.status ?? "unknown"}`,
    `Topic: ${result.topic ?? "unknown"}`,
    `Preset: ${result.preset ?? "none"}`,
    `Agents: ${result.agents.length ? result.agents.join(", ") : "unknown"}`,
    `Manifest: ${result.manifestPath}`,
    `Synthesis: ${result.hasSynthesis ? result.synthesisPath : "missing"}`,
  ];
  if (result.synthesisPreview) {
    lines.push("", result.synthesisPreview);
  }
  return lines.join("\n");
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { docs: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--built-cli") {
      options.builtCli = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${arg} requires a value`);
    }
    i += 1;
    if (key === "doc") {
      options.docs.push(value);
    } else if (key === "timeout-ms") {
      options.timeoutMs = value;
    } else if (key === "project-dir") {
      options.projectDir = value;
    } else {
      options[toCamelCase(key)] = value;
    }
  }
  return { command, options };
}

async function main(argv) {
  const { command, options } = parseArgs(argv);
  if (command === "build-run-command") {
    const result = buildRunCommand(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : result.command);
    return;
  }
  if (command === "inspect-latest-run") {
    const result = await inspectLatestRun(options.projectDir ?? process.cwd());
    console.log(options.json ? JSON.stringify(result, null, 2) : formatRunReport(result));
    return;
  }
  throw new Error(
    "Usage: agent-swarm-helper.mjs <build-run-command|inspect-latest-run> [options]",
  );
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== String(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

async function readJsonIfPresent(filePath) {
  const text = await readTextIfPresent(filePath);
  if (text === null) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${error.message}`);
  }
}

async function readTextIfPresent(filePath) {
  try {
    return await readFile(filePath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function preview(text) {
  const trimmed = text.trim();
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}\n...` : trimmed;
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
