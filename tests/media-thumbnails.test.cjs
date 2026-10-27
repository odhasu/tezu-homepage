const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");
const media = require("../src/components/sites/krea/tezu-media.json");
const thumbnails = require("../src/components/sites/krea/media-thumbnails.json");

const publicDirectory = path.resolve(__dirname, "../public");

test("every original poster has a bounded display image with its source proportions", async () => {
  for (const poster of new Set(media.map(item => item.poster))) {
    const thumbnail = thumbnails[poster];
    assert.ok(thumbnail, poster);
    assert.ok(thumbnail.startsWith("/sites/tezu/thumbnails/"));
    const original = await sharp(path.join(publicDirectory, poster)).metadata();
    const display = await sharp(path.join(publicDirectory, thumbnail)).metadata();
    assert.equal(display.format, "webp");
    assert.ok(display.width <= 640 && display.height <= 640, thumbnail);
    assert.ok(display.width <= original.width && display.height <= original.height);
    assert.ok(Math.abs(display.width / display.height - original.width / original.height) < .01);
  }
});

test("display posters stay within one megabyte while original files remain available", async () => {
  let total = 0;
  for (const poster of new Set(media.map(item => item.poster))) {
    assert.ok((await fs.stat(path.join(publicDirectory, poster))).size > 0);
    total += (await fs.stat(path.join(publicDirectory, thumbnails[poster]))).size;
  }
  assert.ok(total < 1_000_000, `Display images total ${total} bytes`);
});
