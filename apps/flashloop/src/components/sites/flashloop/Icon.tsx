import type { SVGProps } from "react";

type IconName =
  | "arrow"
  | "diagonal"
  | "chevron"
  | "plus"
  | "close"
  | "menu"
  | "settings"
  | "coins"
  | "up"
  | "pixel";
const paths: Record<IconName, string> = {
  arrow: "M4 12h16m-6-6 6 6-6 6",
  diagonal: "M5 19 19 5M7 5h12v12",
  chevron: "m9 5 7 7-7 7",
  plus: "M12 4v16M4 12h16",
  close: "m6 6 12 12M6 18 18 6",
  menu: "M4 5h16M4 12h16M4 19h16",
  settings: "M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2M11 3v6M6 9v6m8 0v6",
  coins: "M10 6a5 5 0 1 1 8 6M6 10a5 5 0 1 0 6 8M10 10l4 4m-2-8 6 6",
  up: "M12 20V4m-7 7 7-7 7 7",
  pixel:
    "M12 5v2h2v2h2v2H4v2h12v2h-2v2h-2v2h2v-2h2v-2h2v-2h2v-2h-2V9h-2V7h-2V5z",
};
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={name === "pixel" ? "currentColor" : "none"}
      stroke={name === "pixel" ? "none" : "currentColor"}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
