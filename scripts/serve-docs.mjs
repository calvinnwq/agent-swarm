#!/usr/bin/env node
// Serve the static docs site (docs/) locally for preview.
//
// The site renders without a build step and is deployed to GitHub Pages as-is
// (see .github/workflows/pages.yml), so a plain static file server rooted at
// docs/ reproduces the published site exactly. This script has zero
// dependencies — it uses only the Node standard library — to stay aligned with
// the no-build ethos of the docs site.
//
// Run `pnpm docs:serve` (optionally `pnpm docs:serve -- --port 4000`), then open
// the printed URL. Press Ctrl+C to stop.
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = path.join(repoRoot, "docs");

const args = process.argv.slice(2);
const portArgIndex = args.findIndex((arg) => arg === "--port" || arg === "-p");
const portFromFlag =
  portArgIndex !== -1 ? Number(args[portArgIndex + 1]) : undefined;
const portFromEnv = process.env.PORT ? Number(process.env.PORT) : undefined;
const resolvedPort =
  [portFromFlag, portFromEnv].find((value) => Number.isFinite(value)) ?? 3000;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function resolveTarget(urlPath) {
  // Strip query/hash and decode, then resolve against the site root, refusing
  // any path that escapes docs/ (path traversal guard).
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  const candidate = path.join(siteRoot, decoded);
  const relative = path.relative(siteRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

function fileFor(target) {
  // GitHub Pages serves index.html for directory requests; mirror that.
  try {
    const stats = statSync(target);
    if (stats.isDirectory()) {
      return fileFor(path.join(target, "index.html"));
    }
    return target;
  } catch {
    return null;
  }
}

const server = createServer((req, res) => {
  const target = resolveTarget(req.url ?? "/");
  const file = target ? fileFor(target) : null;

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }

  const contentType =
    CONTENT_TYPES[path.extname(file).toLowerCase()] ??
    "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(file).pipe(res);
});

server.listen(resolvedPort, () => {
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : resolvedPort;
  console.log(`Serving docs at http://localhost:${actualPort}`);
  console.log("Press Ctrl+C to stop.");
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${resolvedPort} is already in use. Try: pnpm docs:serve -- --port <other-port>`,
    );
    process.exit(1);
  }
  throw error;
});
