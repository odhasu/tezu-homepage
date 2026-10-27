const assert = require("node:assert/strict");
const test = require("node:test");
const { createWallFrameLoop, settleTowards, wallHasMotion } = require("../src/components/sites/krea/wall-animation.ts");

function fakeFrames() {
  let id = 0;
  const pending = new Map();
  return {
    request(callback) { pending.set(++id, callback); return id; },
    cancel(handle) { pending.delete(handle); },
    get count() { return pending.size; },
    tick(time) {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach(callback => callback(time));
    },
  };
}

test("wall wakes once and releases frames as soon as it settles", () => {
  const frames = fakeFrames();
  const deltas = [];
  let moving = true;
  const loop = createWallFrameLoop(frames.request, frames.cancel, delta => { deltas.push(delta); return moving; });
  loop.wake(); loop.wake();
  assert.equal(frames.count, 1);
  frames.tick(100);
  assert.equal(frames.count, 1);
  moving = false;
  frames.tick(116);
  assert.equal(frames.count, 0);
  loop.wake(); frames.tick(10000);
  assert.deepEqual(deltas, [0, .016, 0]);
});

test("stopping hidden/offscreen work cancels pending callbacks and resets elapsed time", () => {
  const frames = fakeFrames();
  const deltas = [];
  const loop = createWallFrameLoop(frames.request, frames.cancel, delta => { deltas.push(delta); return true; });
  loop.wake(); frames.tick(100);
  loop.stop();
  assert.equal(frames.count, 0);
  loop.wake(); frames.tick(10000);
  assert.deepEqual(deltas, [0, 0]);
  loop.stop();
});

test("paused and reduced-motion walls run only while interactive transitions settle", () => {
  const state = { paused: true, reducedMotion: false, targetMoving: false, liftMoving: false, hasTarget: false, dragging: false };
  assert.equal(wallHasMotion(state), false);
  assert.equal(wallHasMotion({ ...state, targetMoving: true }), true);
  assert.equal(wallHasMotion({ ...state, liftMoving: true }), true);
  assert.equal(wallHasMotion({ ...state, paused: false }), true);
  assert.equal(wallHasMotion({ ...state, paused: false, reducedMotion: true }), false);
  assert.equal(wallHasMotion({ ...state, paused: false, hasTarget: true }), false);
  assert.equal(wallHasMotion({ ...state, paused: false, dragging: true }), false);
});

test("target and hover easing stop exactly; reduced motion changes immediately", () => {
  assert.equal(settleTowards(0, 1, .016, .12, true, .001), 1);
  let position = 0;
  for (let i = 0; i < 400; i++) position = settleTowards(position, 100, .016, .2, false, .05);
  assert.equal(position, 100);
  assert.equal(settleTowards(.9999, 1, 0, .12, false, .001), 1);
});
