import { tezuMedia } from "./assets";

export type TezuMotionItem = (typeof tezuMedia)[number];

/** Stable shuffled selections keep server and client markup identical. */
function selection(seed: number): TezuMotionItem[] {
  let state = seed;
  function shuffle(items: TezuMotionItem[]) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index--) {
      state = (state * 1664525 + 1013904223) >>> 0;
      const next = state % (index + 1);
      [result[index], result[next]] = [result[next], result[index]];
    }
    return result;
  }
  const videos = shuffle(tezuMedia.filter(item => item.kind === "video"));
  const images = shuffle(tezuMedia.filter(item => item.kind === "image"));
  let videoIndex = 0;
  let imageIndex = 0;
  return Array.from({ length: 9 }, (_, index) => index % 3 === 1 ? images[imageIndex++ % images.length] : videos[videoIndex++ % videos.length]);
}

export const gallerySelections = {
  lens: selection(2),
  reel: selection(11),
  fold: selection(19),
  arc: selection(7),
};
