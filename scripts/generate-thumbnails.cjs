/* Run from any directory with: node scripts/generate-thumbnails.cjs
 * Sharp is supplied by the installed Next.js dependency. Original media is retained.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const publicDirectory = path.join(root, "public");
const componentDirectory = path.join(root, "src/components/sites/krea");
const outputDirectory = path.join(publicDirectory, "sites/tezu/thumbnails");
const logo = "/sites/tezu/tezu-knot-logo.png";

async function generate() {
  const media = JSON.parse(await fs.readFile(path.join(componentDirectory, "tezu-media.json"), "utf8"));
  const posters = [...new Set(media.map(item => item.poster))].sort();
  const manifest = {};
  const summary = { posters: posters.length, originalPosterBytes: 0, thumbnailPosterBytes: 0, originalLogoBytes: 0, thumbnailLogoBytes: 0 };
  await fs.mkdir(outputDirectory, { recursive: true });

  for (const original of [...posters, logo].sort()) {
    const source = path.resolve(publicDirectory, original.slice(1));
    if (!original.startsWith("/sites/tezu/") || !source.startsWith(`${publicDirectory}${path.sep}`)) {
      throw new Error(`Expected a local Tezu asset: ${original}`);
    }
    const isLogo = original === logo;
    const name = `${path.parse(original).name}${isLogo ? "-90" : "-640"}.webp`;
    const destination = path.join(outputDirectory, name);
    const image = sharp(source).rotate();
    const output = isLogo
      ? image.resize({ width: 90, height: 90, fit: "inside", withoutEnlargement: true }).webp({ lossless: true, effort: 6 })
      : image.resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 85, effort: 6 });
    const result = await output.toFile(destination);
    const originalBytes = (await fs.stat(source)).size;
    if (isLogo) {
      summary.originalLogoBytes = originalBytes;
      summary.thumbnailLogoBytes = result.size;
    } else {
      summary.originalPosterBytes += originalBytes;
      summary.thumbnailPosterBytes += result.size;
    }
    manifest[original] = `/sites/tezu/thumbnails/${name}`;
  }

  await fs.writeFile(path.join(componentDirectory, "media-thumbnails.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

generate().catch(error => { console.error(error); process.exitCode = 1; });
