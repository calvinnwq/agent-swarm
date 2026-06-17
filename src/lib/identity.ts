import path from "node:path";

/**
 * Product + storage identity constants (NGX-478).
 *
 * The CLI ships as `agent-swarm` and stores project/user data under
 * `.agent-swarm/`. The previous identity (`swarm` / `.swarm/`) is still read as
 * a fallback for at least one release so existing projects keep working without
 * a manual migration. New writes always target the current paths; legacy paths
 * are read-only fallbacks and the current path always wins when both exist.
 */

/** Human-facing product name. */
export const PRODUCT_NAME = "Agent Swarm";

/** CLI command name and npm package name. */
export const CLI_NAME = "agent-swarm";

/** Legacy product/CLI name, retained for migration messaging only. */
export const LEGACY_CLI_NAME = "swarm";

/** Current storage directory name (project: `./<dir>`, user: `~/<dir>`). */
export const STORAGE_DIR = ".agent-swarm";

/** Legacy storage directory name, still read as a fallback. */
export const LEGACY_STORAGE_DIR = ".swarm";

/**
 * Storage directory names in precedence order: current identity first, legacy
 * fallback second. Callers that resolve read roots must preserve this order so
 * the current path always wins when both exist.
 */
export const STORAGE_DIRS: readonly string[] = [
  STORAGE_DIR,
  LEGACY_STORAGE_DIR,
];

/** Project config filename within a storage directory. */
export const PROJECT_CONFIG_FILENAME = "config.yml";

/**
 * Project-scope storage roots for a subdirectory (e.g. `agents`, `presets`),
 * current identity first and legacy fallback second.
 */
export function projectStorageRoots(cwd: string, subdir: string): string[] {
  return STORAGE_DIRS.map((dir) => path.join(cwd, dir, subdir));
}

/**
 * User-scope storage roots for a subdirectory (e.g. `agents`, `presets`),
 * current identity first and legacy fallback second.
 */
export function userStorageRoots(homeDir: string, subdir: string): string[] {
  return STORAGE_DIRS.map((dir) => path.join(homeDir, dir, subdir));
}
