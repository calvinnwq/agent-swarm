import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { SwarmPresetSchema, type SwarmPreset } from "../schemas/index.js";
import { projectStorageRoots, userStorageRoots } from "./identity.js";
import { SwarmCommandError } from "./parse-command.js";

const DEFINITION_EXTENSIONS = new Set([".yml", ".yaml"]);
const DEFAULT_BUNDLED_DIR_CANDIDATES = [
  fileURLToPath(new URL("./presets/bundled", import.meta.url)),
  fileURLToPath(new URL("../presets/bundled", import.meta.url)),
  fileURLToPath(new URL("../src/presets/bundled", import.meta.url)),
];

export interface LoadPresetRegistryOptions {
  cwd?: string;
  homeDir?: string;
  bundledDir?: string;
}

export interface PresetRegistry {
  getPreset(name: string): SwarmPreset;
  listPresets(): SwarmPreset[];
  searchedRoots: string[];
}

export async function resolvePresetByName(
  name: string,
  options: LoadPresetRegistryOptions = {},
): Promise<SwarmPreset> {
  const normalizedName = normalizePresetName(name);
  const searchedRoots = await resolvePresetRoots(options);

  for (const root of searchedRoots) {
    const preset = await loadPresetByNameFromRoot(root, normalizedName);
    if (preset) {
      return preset;
    }
  }

  throw new SwarmCommandError(
    `unknown preset "${normalizedName}" (searched: ${searchedRoots.join(", ")})`,
  );
}

export async function loadPresetRegistry(
  options: LoadPresetRegistryOptions = {},
): Promise<PresetRegistry> {
  const searchedRoots = await resolvePresetRoots(options);

  const presets = new Map<string, SwarmPreset>();

  for (const root of searchedRoots) {
    const rootPresets = await loadPresetsFromRoot(root);
    for (const preset of rootPresets) {
      if (!presets.has(preset.name)) {
        presets.set(preset.name, preset);
      }
    }
  }

  return {
    searchedRoots,
    listPresets() {
      return Array.from(presets.values());
    },
    getPreset(name: string) {
      const normalized = normalizePresetName(name);
      const preset = presets.get(normalized);
      if (preset) {
        return preset;
      }
      throw new SwarmCommandError(
        `unknown preset "${normalized}" (searched: ${searchedRoots.join(", ")})`,
      );
    },
  };
}

async function resolvePresetRoots(
  options: LoadPresetRegistryOptions,
): Promise<string[]> {
  const bundledDir = options.bundledDir
    ? path.resolve(options.bundledDir)
    : await resolveDefaultBundledDir();
  // Project roots first, then user roots, then bundled. Within each scope the
  // current `.agent-swarm/presets` root precedes legacy `.swarm/presets`, so a
  // current preset wins over a same-name legacy one (first match wins).
  return [
    ...projectStorageRoots(
      path.resolve(options.cwd ?? process.cwd()),
      "presets",
    ),
    ...userStorageRoots(path.resolve(options.homeDir ?? homedir()), "presets"),
    bundledDir,
  ];
}

async function resolveDefaultBundledDir(): Promise<string> {
  for (const candidate of DEFAULT_BUNDLED_DIR_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return DEFAULT_BUNDLED_DIR_CANDIDATES[1];
}

async function loadPresetsFromRoot(root: string): Promise<SwarmPreset[]> {
  const filePaths = await listPresetFiles(root);

  const presets: SwarmPreset[] = [];
  const seenNames = new Map<string, string>();

  for (const filePath of filePaths) {
    const preset = await loadPresetFile(filePath);
    const existingPath = seenNames.get(preset.name);
    if (existingPath) {
      throw new SwarmCommandError(
        `duplicate preset "${preset.name}" in ${root}: ${existingPath} and ${filePath}`,
      );
    }
    seenNames.set(preset.name, filePath);
    presets.push(preset);
  }

  return presets;
}

async function loadPresetByNameFromRoot(
  root: string,
  normalizedName: string,
): Promise<SwarmPreset | undefined> {
  const filePaths = await listPresetFiles(root);
  const matchingPresets: SwarmPreset[] = [];
  const matchingPaths: string[] = [];

  for (const filePath of filePaths) {
    const preset = await loadPresetFileIgnoringUnrelatedErrors(
      filePath,
      normalizedName,
    );
    if (!preset || preset.name !== normalizedName) {
      continue;
    }
    matchingPresets.push(preset);
    matchingPaths.push(filePath);
  }

  if (matchingPresets.length > 1) {
    throw new SwarmCommandError(
      `duplicate preset "${normalizedName}" in ${root}: ${matchingPaths.join(" and ")}`,
    );
  }

  return matchingPresets[0];
}

async function listPresetFiles(root: string): Promise<string[]> {
  const filePaths: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (dir === root && isMissingDirectory(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (
        entry.isFile() &&
        DEFINITION_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        filePaths.push(entryPath);
      }
    }
  }

  await visit(root);
  return filePaths.sort((left, right) => left.localeCompare(right));
}

async function loadPresetFile(filePath: string): Promise<SwarmPreset> {
  const raw = await readFile(filePath, "utf-8");
  let loaded: unknown;
  try {
    loaded = loadYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SwarmCommandError(
      `failed to parse YAML in ${filePath}: ${message}`,
    );
  }

  const parsed = SwarmPresetSchema.safeParse(loaded);
  if (!parsed.success) {
    throw new SwarmCommandError(
      `invalid preset in ${filePath}:\n${formatZodError(parsed.error)}`,
    );
  }
  return parsed.data;
}

async function loadPresetFileIgnoringUnrelatedErrors(
  filePath: string,
  normalizedName: string,
): Promise<SwarmPreset | undefined> {
  try {
    return await loadPresetFile(filePath);
  } catch (error) {
    if (
      error instanceof SwarmCommandError &&
      path.parse(filePath).name.toLowerCase() !== normalizedName
    ) {
      return undefined;
    }
    throw error;
  }
}

function normalizePresetName(name: string): string {
  return name.trim().toLowerCase();
}

function formatZodError(error: import("zod").ZodError): string {
  return error.issues
    .map((issue) => {
      const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `  - ${pathLabel}: ${issue.message}`;
    })
    .join("\n");
}

function isMissingDirectory(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
