import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const siteDir = path.join(repoRoot, "docs", "site");
const pagesWorkflowPath = path.join(
  repoRoot,
  ".github",
  "workflows",
  "pages.yml",
);
const readmePath = path.join(repoRoot, "README.md");

// The deployed docs site lives at the project's GitHub Pages origin. The README
// links here and the Pages workflow publishes docs/site/ to it.
const DOCS_SITE_URL = "calvinnwq.github.io/agent-swarm";

// The static docs site renders without a build step, so every page is a plain
// HTML file under docs/site/ that inlines the shared chrome. These are the
// canonical top-level pages the navigation links between.
const CANONICAL_PAGES = [
  "index.html",
  "quickstart.html",
  "reference.html",
  "architecture.html",
  "agent-usage.html",
  "release-readiness.html",
];

const SHARED_ASSETS = ["assets/styles.css", "assets/site.js"];

// The docs site mirrors the README, which is the authoritative user-facing
// contract. The reference page must list every bundled preset so the site
// cannot quietly drift from the runtime it describes.
const BUNDLED_PRESETS_DIR = path.join(repoRoot, "src", "presets", "bundled");

async function bundledPresetNames(): Promise<string[]> {
  const entries = await readdir(BUNDLED_PRESETS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yml"))
    .map((entry) => entry.name.replace(/\.yml$/, ""))
    .sort();
}

// Stable contract/chrome text each page must surface so the docs cannot quietly
// drift away from the runtime they describe.
const CONTRACT_TEXT: Record<string, string[]> = {
  "index.html": ["Agent Swarm", "synthesis", "deterministic"],
  "quickstart.html": [
    "npx -y @calvinnwq/agent-swarm",
    "agent-swarm doctor",
    "product-decision",
    "--timeout-ms",
  ],
  "reference.html": [
    "off | orchestrator | agents",
    "--resolve",
    "--backend",
    "product-decision",
  ],
  "architecture.html": ["harness", "backend", "synthesis", "checkpoint.json"],
  "agent-usage.html": [".agent-swarm/config.yml", "product-triad"],
  "release-readiness.html": ["Release Please", "readiness"],
};

async function listHtmlPages(): Promise<string[]> {
  const entries = await readdir(siteDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort();
}

async function readPage(name: string): Promise<string> {
  return readFile(path.join(siteDir, name), "utf-8");
}

function extractAttribute(html: string, attribute: string): string[] {
  const pattern = new RegExp(
    `${attribute}\\s*=\\s*"([^"]*)"|${attribute}\\s*=\\s*'([^']*)'`,
    "gi",
  );
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    values.push(match[1] ?? match[2] ?? "");
  }
  return values;
}

function extractReferences(html: string): string[] {
  return [...extractAttribute(html, "href"), ...extractAttribute(html, "src")];
}

function extractIds(html: string): Set<string> {
  return new Set(extractAttribute(html, "id").filter(Boolean));
}

function hasScheme(reference: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//");
}

describe("static docs site", () => {
  it("publishes the canonical docs pages and shared assets", () => {
    for (const page of CANONICAL_PAGES) {
      expect(existsSync(path.join(siteDir, page)), page).toBe(true);
    }
    for (const asset of SHARED_ASSETS) {
      expect(existsSync(path.join(siteDir, asset)), asset).toBe(true);
    }
  });

  it("renders shared chrome and navigation on every page", async () => {
    const pages = await listHtmlPages();
    expect(pages.length).toBeGreaterThanOrEqual(CANONICAL_PAGES.length);

    for (const page of pages) {
      const html = await readPage(page);
      expect(html, page).toMatch(/<!doctype html>/i);
      expect(html, page).toContain('lang="en"');
      expect(html, page).toMatch(/<title>[^<]*Agent Swarm[^<]*<\/title>/);
      expect(html, page).toContain('name="viewport"');
      expect(html, page).toContain('href="assets/styles.css"');
      expect(html, page).toContain('src="assets/site.js"');
      expect(html, page).toContain("site-header");
      expect(html, page).toContain("site-nav");
      expect(html, page).toContain("site-footer");
      // The navigation links to every canonical page on every page.
      for (const target of CANONICAL_PAGES) {
        expect(html, `${page} nav -> ${target}`).toContain(`href="${target}"`);
      }
    }
  });

  it("has no broken local links, anchors, or asset references", async () => {
    const pages = await listHtmlPages();

    for (const page of pages) {
      const html = await readPage(page);
      const ids = extractIds(html);
      const pageDir = path.dirname(path.join(siteDir, page));

      for (const reference of extractReferences(html)) {
        if (!reference || hasScheme(reference)) continue;

        if (reference.startsWith("#")) {
          const anchor = reference.slice(1);
          if (anchor) {
            expect(ids.has(anchor), `${page} -> ${reference}`).toBe(true);
          }
          continue;
        }

        const targetPath = reference.split("#")[0].split("?")[0];
        if (!targetPath) continue;

        let resolved = path.resolve(pageDir, targetPath);
        if (targetPath.endsWith("/")) {
          resolved = path.join(resolved, "index.html");
        } else if (existsSync(resolved) && statSync(resolved).isDirectory()) {
          resolved = path.join(resolved, "index.html");
        }
        expect(existsSync(resolved), `${page} -> ${reference}`).toBe(true);
      }
    }
  });

  it("surfaces key contract text on the docs pages", async () => {
    for (const [page, snippets] of Object.entries(CONTRACT_TEXT)) {
      const html = await readPage(page);
      for (const snippet of snippets) {
        expect(html, `${page} contract: ${snippet}`).toContain(snippet);
      }
    }
  });

  it("lists every bundled preset on the reference page", async () => {
    const reference = await readPage("reference.html");
    for (const preset of await bundledPresetNames()) {
      expect(reference, `reference.html preset: ${preset}`).toContain(preset);
    }
  });

  it("keeps the docs site free of maintainer personal-name references", async () => {
    const pages = await listHtmlPages();
    for (const page of pages) {
      const html = await readPage(page);
      expect(html, page).not.toMatch(/\bCalvin\b/);
    }
  });
});

describe("docs site deployment", () => {
  it("ships a GitHub Pages workflow that publishes docs/site without a build", async () => {
    expect(existsSync(pagesWorkflowPath), "pages.yml").toBe(true);
    const workflow = await readFile(pagesWorkflowPath, "utf-8");

    // Deploys via the official no-build Pages pipeline: upload the static
    // docs/site/ directory as the artifact, then deploy it.
    expect(workflow).toContain("actions/configure-pages");
    expect(workflow).toContain("actions/upload-pages-artifact");
    expect(workflow).toContain("actions/deploy-pages");
    expect(workflow).toMatch(/path:\s*docs\/site/);

    // GitHub Pages deployment requires these OIDC + pages permissions.
    expect(workflow).toMatch(/pages:\s*write/);
    expect(workflow).toMatch(/id-token:\s*write/);

    // Publishes from main and can be triggered manually.
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toMatch(/branches:\s*\n\s*-\s*main/);
  });

  it("links the README to the deployed docs site", async () => {
    const readme = await readFile(readmePath, "utf-8");
    expect(readme).toContain(DOCS_SITE_URL);
  });
});
