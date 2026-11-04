import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const assets = JSON.parse(
  await readFile(path.join(root, "docs/assets.json"), "utf8"),
);
const content = JSON.parse(
  await readFile(
    path.join(root, "src/components/sites/flashloop/content.json"),
    "utf8",
  ),
);
const references = new Set(Object.keys(assets));
function visit(value) {
  if (typeof value === "string" && value.startsWith("/sites/"))
    references.add(value);
  else if (Array.isArray(value)) value.forEach(visit);
  else if (value && typeof value === "object")
    Object.values(value).forEach(visit);
}
visit(content);
const failures = [];
let bytes = 0;
for (const reference of references) {
  try {
    const file = await stat(path.join(root, "public", reference));
    if (!file.isFile() || file.size === 0) failures.push(reference);
    else bytes += file.size;
  } catch {
    failures.push(reference);
  }
}
if (failures.length) {
  console.error("Missing or empty assets:", failures);
  process.exitCode = 1;
} else {
  console.log(
    `Verified ${references.size} local assets (${bytes.toLocaleString()} bytes).`,
  );
}
