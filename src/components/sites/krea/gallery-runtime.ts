/** One frame for manual changes; recurring frames only while motion is active. */
export function createGalleryFrameLoop(
  render: (elapsed: number) => void,
  shouldAnimate: () => boolean,
  request: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (frame: number) => void = cancelAnimationFrame,
) {
  let frame: number | null = null;
  let last: number | null = null;
  let disposed = false;
  const wake = () => {
    if (!disposed && frame === null) frame = request(tick);
  };
  const tick: FrameRequestCallback = time => {
    frame = null;
    if (disposed) return;
    render(last === null ? 0 : Math.min(time - last, 50));
    if (shouldAnimate()) {
      last = time;
      wake();
    } else last = null;
  };
  const sleep = () => {
    if (frame !== null) cancel(frame);
    frame = null;
    last = null;
  };
  return { wake, sleep, dispose: () => { disposed = true; sleep(); } };
}

/** Autoplay denial stays quiet until eligibility changes or the user retries. */
export function createGalleryVideoPlayback(video: Pick<HTMLVideoElement, "play" | "pause" | "paused">) {
  let desired = false;
  let pending = false;
  let blocked = false;
  let disposed = false;
  let generation = 0;
  const setPlaying = (playing: boolean) => {
    if (disposed) return;
    if (desired !== playing) {
      generation++;
      desired = playing;
      if (playing) blocked = false;
    }
    if (!playing) {
      if (pending || !video.paused) video.pause();
      return;
    }
    if (pending || blocked || !video.paused) return;
    pending = true;
    const request = generation;
    const rejected = () => {
      pending = false;
      if (desired && generation === request) blocked = true;
    };
    try {
      void video.play().then(() => {
        pending = false;
        if (!desired || disposed) video.pause();
      }, rejected);
    } catch { rejected(); }
  };
  return {
    setPlaying,
    retry: () => { blocked = false; },
    dispose: () => { setPlaying(false); disposed = true; },
  };
}
