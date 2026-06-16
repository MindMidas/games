import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssRoot = path.join(frontendRoot, "src", "css", "platform");
const outputRoot = path.join(frontendRoot, "static", "games", "platform", "css");
const outputFile = "game-shared-bundle.css";
const sources = [
  "game-typography.css",
  "game-components.css",
  "game-shell.css",
  "game-scatter.css",
  "game-shared-ui.css",
  "game-shell-chrome.css",
  "game-ui-parity.css",
  "game-drawer.css",
  "game-arena.css",
  "game-app.css",
];

const chunks = [];
for (const fileName of sources) {
  const source = await fs.readFile(path.join(cssRoot, fileName), "utf8");
  chunks.push(`/* ${fileName} */\n${source.trim()}\n`);
}
await fs.mkdir(outputRoot, { recursive: true });
await fs.writeFile(path.join(outputRoot, outputFile), chunks.join("\n"));
