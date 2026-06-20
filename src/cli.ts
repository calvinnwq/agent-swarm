import { readFileSync } from "node:fs";
import { runCli } from "./lib/index.js";

const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version as string;

await runCli(version);
