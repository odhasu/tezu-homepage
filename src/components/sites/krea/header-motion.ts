/** Timing values from the Arc Site Header reference. */
export const motionTokens = {
  duration: { instant: .12, fast: .16, exit: .18, standard: .24, considered: .48 },
  ease: { enter: [.16, 1, .3, 1], standard: [.22, 1, .36, 1] },
  spring: {
    snappy: { type: "spring", visualDuration: .26, bounce: 0 },
    smooth: { type: "spring", visualDuration: .4, bounce: 0 },
    morph: { type: "spring", visualDuration: .42, bounce: 0 },
  },
  stagger: { item: .035 },
  blur: { subtle: 2 },
} as const;
