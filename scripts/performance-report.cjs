/* Run after the production static export: node scripts/performance-report.cjs */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "out");
const media = require("../src/components/sites/krea/tezu-media.json");
const thumbnails = require("../src/components/sites/krea/media-thumbnails.json");
const bytes = file => fs.statSync(file).size;
const sum = items => items.reduce((total, item) => total + item, 0);

function routeReport(route) {
  const html = fs.readFileSync(path.join(output, route, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]+)>/g)].flatMap(([, attributes]) => {
    const source = attributes.match(/\bsrc="([^"]+)"/);
    if (!source) return [];
    const local = source[1].slice(source[1].indexOf("/_next/") + 1);
    const content = fs.readFileSync(path.join(output, local));
    return [{ file: local, legacyOnly: /\bnomodule\b|\bnoModule\b/.test(attributes), bytes: content.length, gzipBytes: zlib.gzipSync(content).length }];
  });
  const unique = [...new Map(scripts.map(item => [item.file, item])).values()];
  const modern = unique.filter(item => !item.legacyOnly);
  return {
    htmlBytes: Buffer.byteLength(html),
    allScriptBytes: sum(unique.map(item => item.bytes)),
    modernScriptBytes: sum(modern.map(item => item.bytes)),
    estimatedModernGzipBytes: sum(modern.map(item => item.gzipBytes)),
    scripts: unique,
  };
}

const posters = [...new Set(media.map(item => item.poster))];
process.stdout.write(`${JSON.stringify({
  note: "Exported resource sizes, not network timings. Gzip is a local estimate; legacy nomodule scripts are excluded from modern totals.",
  homepage: routeReport(""),
  motionControl: routeReport("motion-control"),
  posters: {
    count: posters.length,
    originalBytes: sum(posters.map(src => bytes(path.join(root, "public", src)))),
    displayBytes: sum(posters.map(src => bytes(path.join(root, "public", thumbnails[src])))),
  },
}, null, 2)}\n`);
