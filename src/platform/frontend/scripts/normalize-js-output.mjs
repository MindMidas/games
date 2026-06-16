import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticGamesRoot = path.join(frontendRoot, "static", "games");
const gameIds = ["platform", "pool", "chezz"];
const jsDirs = ["app", "features", "game", "shared", "shell"];

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function rewriteCompiledImports(filePath) {
  if (!filePath.endsWith(".js")) {
    return;
  }
  const source = await fs.readFile(filePath, "utf8");
  const rewriteSpecifier = (specifier) => {
    const parts = specifier.split("/");
    const targetIndex = parts.findIndex((part) => [...gameIds, "app"].includes(part));
    if (targetIndex < 0) {
      return specifier;
    }
    const target = parts[targetIndex];
    const restParts = parts.slice(targetIndex + 1);
    const rest = restParts.join("/");
    const targetPath = path.join(
      staticGamesRoot,
      target,
      target === "app" || restParts[0] === "js" ? rest : path.join("js", rest),
    );
    let relative = path.relative(path.dirname(filePath), targetPath).replace(/\\/g, "/");
    if (!relative.startsWith(".")) {
      relative = `./${relative}`;
    }
    return relative;
  };
  const next = source
    .replace(/(from\s+["'])([^"']+)(["'])/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${rewriteSpecifier(specifier)}${suffix}`;
    })
    .replace(/(import\(\s*["'])([^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) => {
      return `${prefix}${rewriteSpecifier(specifier)}${suffix}`;
    });
  if (next !== source) {
    await fs.writeFile(filePath, next);
  }
}

async function moveTree(sourceRoot, destRoot) {
  for (const entry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const destPath = path.join(destRoot, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await moveTree(sourcePath, destPath);
      continue;
    }
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.rename(sourcePath, destPath);
    await rewriteCompiledImports(destPath);
  }
}

async function moveRootCompiledFiles(sourceRoot, destRoot) {
  for (const entry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || (!entry.name.endsWith(".js") && !entry.name.endsWith(".js.map"))) {
      continue;
    }
    const sourcePath = path.join(sourceRoot, entry.name);
    const destPath = path.join(destRoot, entry.name);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.rename(sourcePath, destPath);
    await rewriteCompiledImports(destPath);
  }
}

async function rewriteAllCompiledImports(root) {
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await rewriteAllCompiledImports(entryPath);
    } else {
      await rewriteCompiledImports(entryPath);
    }
  }
}

for (const gameId of gameIds) {
  const destRoot = path.join(staticGamesRoot, gameId, "js");
  await fs.mkdir(destRoot, { recursive: true });
  await moveRootCompiledFiles(path.join(staticGamesRoot, gameId), destRoot);
  for (const dirName of jsDirs) {
    const sourceRoot = path.join(staticGamesRoot, gameId, dirName);
    if (!(await pathExists(sourceRoot))) {
      continue;
    }
    await moveTree(sourceRoot, path.join(destRoot, dirName));
    await fs.rm(sourceRoot, { recursive: true, force: true });
  }
}

await rewriteAllCompiledImports(staticGamesRoot);
