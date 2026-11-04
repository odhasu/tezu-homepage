import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "out");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const missing = new Set();
const checked = new Set();
async function check(url) {
  if (!url.startsWith("/") || url.startsWith("//")) return;
  if (basePath && !url.startsWith(`${basePath}/`)) {
    missing.add(`Unprefixed URL: ${url}`);
    return;
  }
  const relative = decodeURIComponent(url.slice(basePath.length).split(/[?#]/)[0]);
  const target = path.join(output, relative);
  if (checked.has(target)) return;
  checked.add(target);
  try {
    const info = await stat(target);
    if (info.isDirectory()) await stat(path.join(target, "index.html"));
  } catch { missing.add(url); }
}
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(html|css)$/.test(file)) {
      const source = await readFile(file, "utf8");
      const pattern = file.endsWith(".html") ? /(?:src|href|poster)="([^"]+)"/g : /url\(["']?([^\)"']+)/g;
      for (const match of source.matchAll(pattern)) await check(match[1]);
      if (file.endsWith(".html")) {
        for (const match of source.matchAll(/url\(([\/]\S+?)\)/g)) await check(match[1]);
      }
    }
  }
}
await visit(output);
if (missing.size) {
  console.error([...missing].join("\n"));
  process.exitCode = 1;
} else console.log(`Verified ${checked.size} exported routes/assets for ${basePath || "/"}.`);
