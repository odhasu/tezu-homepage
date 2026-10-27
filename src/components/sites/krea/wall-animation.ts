/** One pending frame at a time; a settled render gives the browser its idle time back. */
export function createWallFrameLoop(
  request: (callback: (time: number) => void) => number,
  cancel: (handle: number) => void,
  render: (deltaSeconds: number) => boolean,
) {
  let frame: number | null = null;
  let previous: number | null = null;
  const wake = () => {
    if (frame !== null) return;
    frame = request(time => {
      frame = null;
      const delta = previous === null ? 0 : Math.min(.05, (time - previous) / 1000);
      previous = time;
      if (render(delta)) wake();
      else previous = null;
    });
  };
  const stop = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    previous = null;
  };
  return { wake, stop };
}

export function settleTowards(current: number, target: number, delta: number, duration: number, immediate: boolean, epsilon: number) {
  const next = immediate ? target : current + (target - current) * (1 - Math.exp(-delta / duration));
  return Math.abs(target - next) <= epsilon ? target : next;
}

export function wallHasMotion(state: {
  paused: boolean; reducedMotion: boolean; dragging: boolean; hasTarget: boolean; targetMoving: boolean; liftMoving: boolean;
}) {
  return state.targetMoving || state.liftMoving || (!state.paused && !state.reducedMotion && !state.dragging && !state.hasTarget);
}
