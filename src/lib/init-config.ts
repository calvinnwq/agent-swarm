import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  CLI_NAME,
  LEGACY_STORAGE_DIR,
  PROJECT_CONFIG_FILENAME,
  STORAGE_DIR,
} from "./identity.js";
import { PROJECT_CONFIG_RELATIVE_PATH } from "./load-project-config.js";
import { SwarmCommandError } from "./parse-command.js";

/**
 * Minimal, safe project-config defaults written by `agent-swarm init` (NGX-489).
 *
 * `init` is a tiny deterministic helper: it only ever creates or (with
 * `--force`) overwrites `.agent-swarm/config.yml`. It never runs swarms,
 * installs anything, or mutates unrelated files. The generated config stays
 * intentionally minimal so coding agents do not hand-roll inconsistent configs.
 */

export const DEFAULT_INIT_PRESET = "product-triad";
export const DEFAULT_INIT_RESOLVE = "off";
export const DEFAULT_INIT_TIMEOUT_MS = 300_000;

/**
 * Deterministic contents written for a fresh `.agent-swarm/config.yml`. The
 * header documents the precedence contract inline so users see it in their repo.
 * `resolve: off` is unquoted and parses back as the string "off" under the
 * YAML 1.2 core schema js-yaml uses, matching `ResolveModeSchema`.
 */
export const DEFAULT_INIT_CONFIG_YAML = [
  "# agent-swarm project config",
  "# CLI flags override these values, which override preset defaults.",
  `preset: ${DEFAULT_INIT_PRESET}`,
  `resolve: ${DEFAULT_INIT_RESOLVE}`,
  `timeoutMs: ${DEFAULT_INIT_TIMEOUT_MS}`,
  "",
].join("\n");

export type InitConfigStatus = "created" | "exists" | "overwritten";

export interface InitProjectConfigOptions {
  cwd?: string;
  /** Overwrite an existing `.agent-swarm/config.yml` with the defaults. */
  force?: boolean;
}

export interface InitProjectConfigResult {
  status: InitConfigStatus;
  /** Absolute path to `.agent-swarm/config.yml`. */
  filePath: string;
  /** Project-relative path that was created or examined. */
  relativePath: string;
  /** Contents now at `filePath` (defaults when written, existing when preserved). */
  contents: string;
  /** True when a legacy `.swarm/config.yml` exists alongside the current path. */
  legacyDetected: boolean;
}

export async function initProjectConfig(
  options: InitProjectConfigOptions = {},
): Promise<InitProjectConfigResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const configDir = path.join(cwd, STORAGE_DIR);
  const filePath = path.join(configDir, PROJECT_CONFIG_FILENAME);
  const legacyPath = path.join(
    cwd,
    LEGACY_STORAGE_DIR,
    PROJECT_CONFIG_FILENAME,
  );

  const legacyDetected = await fileExists(legacyPath);
  const existing = await readIfPresent(filePath);

  // Preserve an existing config (even an invalid one) unless force is set, so
  // `init` never silently destroys user data.
  if (existing !== null && options.force !== true) {
    return {
      status: "exists",
      filePath,
      relativePath: PROJECT_CONFIG_RELATIVE_PATH,
      contents: existing,
      legacyDetected,
    };
  }

  try {
    await mkdir(configDir, { recursive: true });
    await writeFile(filePath, DEFAULT_INIT_CONFIG_YAML, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `failed to write ${PROJECT_CONFIG_RELATIVE_PATH}: ${message}`,
    );
  }

  return {
    status: existing !== null ? "overwritten" : "created",
    filePath,
    relativePath: PROJECT_CONFIG_RELATIVE_PATH,
    contents: DEFAULT_INIT_CONFIG_YAML,
    legacyDetected,
  };
}

export function formatInitResult(result: InitProjectConfigResult): string {
  const lines: string[] = [];
  switch (result.status) {
    case "created":
      lines.push(`${CLI_PREFIX} created ${result.relativePath}`);
      break;
    case "overwritten":
      lines.push(`${CLI_PREFIX} overwrote ${result.relativePath}`);
      break;
    case "exists":
      lines.push(
        `${CLI_PREFIX} ${result.relativePath} already exists; left unchanged`,
      );
      lines.push("Re-run with --force to overwrite it with the defaults.");
      break;
  }

  if (result.status !== "exists") {
    lines.push(
      "CLI flags override these values, which override preset defaults.",
    );
  }

  if (result.legacyDetected) {
    lines.push(
      `Note: a legacy ${LEGACY_STORAGE_DIR}/${PROJECT_CONFIG_FILENAME} was found and left as-is.`,
    );
  }

  return lines.join("\n");
}

const CLI_PREFIX = `${CLI_NAME} init:`;

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `failed to read ${PROJECT_CONFIG_RELATIVE_PATH}: ${message}`,
    );
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf-8");
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
