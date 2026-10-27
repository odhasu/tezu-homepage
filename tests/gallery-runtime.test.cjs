const assert = require("node:assert/strict");
const test = require("node:test");
const { createGalleryFrameLoop, createGalleryVideoPlayback } = require("../src/components/sites/krea/gallery-runtime.ts");

function frameClock() {
  let next = 0;
  const callbacks = new Map();
  return {
    request(callback) { callbacks.set(++next, callback); return next; },
    cancel(id) { callbacks.delete(id); },
    get pending() { return callbacks.size; },
    tick(time) { const queued = [...callbacks.values()]; callbacks.clear(); queued.forEach(callback => callback(time)); },
  };
}

test("an idle carousel paints once and leaves no recurring animation work", () => {
  const clock = frameClock();
  let paints = 0;
  const loop = createGalleryFrameLoop(() => { paints++; }, () => false, clock.request, clock.cancel);
  loop.wake();
  loop.wake();
  assert.equal(clock.pending, 1);
  clock.tick(100);
  assert.equal(paints, 1);
  assert.equal(clock.pending, 0);
  loop.wake(); // A manual Next action still paints while automatic motion is paused.
  clock.tick(200);
  assert.equal(paints, 2);
  assert.equal(clock.pending, 0);
});

test("sleep cancels scheduled motion and resuming does not jump across hidden time", () => {
  const clock = frameClock();
  const elapsed = [];
  const loop = createGalleryFrameLoop(delta => elapsed.push(delta), () => true, clock.request, clock.cancel);
  loop.wake();
  clock.tick(100);
  clock.tick(116);
  loop.sleep();
  assert.equal(clock.pending, 0);
  loop.wake();
  clock.tick(10000);
  assert.deepEqual(elapsed, [0, 16, 0]);
  loop.dispose();
  loop.wake();
  assert.equal(clock.pending, 0);
});

test("turning automatic motion off lets its final frame settle without another request", () => {
  const clock = frameClock();
  let animate = true;
  const loop = createGalleryFrameLoop(() => {}, () => animate, clock.request, clock.cancel);
  loop.wake();
  clock.tick(100);
  assert.equal(clock.pending, 1);
  animate = false;
  clock.tick(116);
  assert.equal(clock.pending, 0);
});

const settle = () => new Promise(resolve => setImmediate(resolve));

test("pending autoplay has one request and rejection sleeps until an explicit retry", async () => {
  let requests = 0;
  let reject;
  const video = { paused: true, play() { requests++; return new Promise((resolve, fail) => { reject = fail; }); }, pause() {} };
  const playback = createGalleryVideoPlayback(video);
  for (let index = 0; index < 60; index++) playback.setPlaying(true);
  assert.equal(requests, 1);
  reject(new Error("Autoplay denied"));
  await settle();
  for (let index = 0; index < 60; index++) playback.setPlaying(true);
  assert.equal(requests, 1);
  playback.retry();
  playback.setPlaying(true);
  assert.equal(requests, 2);
});

test("a real playback transition permits a retry after autoplay rejection", async () => {
  let requests = 0;
  const video = { paused: true, play() { requests++; return Promise.reject(new Error("Autoplay denied")); }, pause() {} };
  const playback = createGalleryVideoPlayback(video);
  playback.setPlaying(true);
  await settle();
  playback.setPlaying(false);
  playback.setPlaying(true);
  assert.equal(requests, 2);
  await settle();
});

test("a pending video cannot resume after the gallery is stopped or disposed", async () => {
  let complete;
  const video = { paused: true, play() { return new Promise(resolve => { complete = () => { video.paused = false; resolve(); }; }); }, pause() { video.paused = true; } };
  const playback = createGalleryVideoPlayback(video);
  playback.setPlaying(true);
  playback.setPlaying(false);
  complete();
  await settle();
  assert.equal(video.paused, true);
  playback.dispose();
  playback.setPlaying(true);
  assert.equal(video.paused, true);
});
