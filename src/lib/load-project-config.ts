import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load as loadYaml } from "js-yaml";
import {
  SwarmProjectConfigSchema,
  type SwarmProjectConfig,
} from "../schemas/index.js";
import {
  LEGACY_STORAGE_DIR,
  PROJECT_CONFIG_FILENAME,
  STORAGE_DIR,
  STORAGE_DIRS,
} from "./identity.js";
import { SwarmCommandError } from "./parse-command.js";

/** Current project config path, relative to the project root. */
export const PROJECT_CONFIG_RELATIVE_PATH = `${STORAGE_DIR}/${PROJECT_CONFIG_FILENAME}`;

/**
 * Legacy project config path. Read as a fallback when the current
 * `.agent-swarm/config.yml` is absent, so existing projects keep working.
 */
export const LEGACY_PROJECT_CONFIG_RELATIVE_PATH = `${LEGACY_STORAGE_DIR}/${PROJECT_CONFIG_FILENAME}`;

export interface LoadProjectConfigOptions {
  cwd?: string;
}

export interface LoadedProjectConfig {
  config: SwarmProjectConfig;
  filePath: string;
  /** Project-relative path that was loaded (current or legacy). */
  relativePath: string;
  /** True when the config was loaded from the legacy `.swarm/` path. */
  isLegacy: boolean;
}

export async function loadProjectConfig(
  options: LoadProjectConfigOptions = {},
): Promise<LoadedProjectConfig | null> {
  const cwd = path.resolve(options.cwd ?? process.cwd());

  // Prefer the current `.agent-swarm/` path; fall back to legacy `.swarm/` only
  // when the current one is absent. A present-but-broken current config surfaces
  // its error rather than being masked by a legacy file.
  for (const dir of STORAGE_DIRS) {
    const relativePath = `${dir}/${PROJECT_CONFIG_FILENAME}`;
    const filePath = path.join(cwd, dir, PROJECT_CONFIG_FILENAME);

    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error) {
      if (isMissingFile(error)) {
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new SwarmCommandError(`failed to read ${relativePath}: ${message}`);
    }

    return parseLoadedConfig(
      raw,
      filePath,
      relativePath,
      dir === LEGACY_STORAGE_DIR,
    );
  }

  return null;
}

function parseLoadedConfig(
  raw: string,
  filePath: string,
  relativePath: string,
  isLegacy: boolean,
): LoadedProjectConfig {
  let loaded: unknown;
  try {
    loaded = loadYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(`invalid YAML in ${relativePath}: ${message}`);
  }

  if (loaded === null || loaded === undefined) {
    return { config: {}, filePath, relativePath, isLegacy };
  }

  const parsed = SwarmProjectConfigSchema.safeParse(loaded);
  if (!parsed.success) {
    throw new SwarmCommandError(
      `invalid ${relativePath}:\n${formatZodError(parsed.error)}`,
    );
  }

  return { config: parsed.data, filePath, relativePath, isLegacy };
}

function formatZodError(error: import("zod").ZodError): string {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${pathLabel}: ${issue.message}`;
    })
    .join("\n");
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
