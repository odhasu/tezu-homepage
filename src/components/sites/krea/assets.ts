import sourceMedia from "./tezu-media.json";

export function publicAsset(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

export const tezuMedia = sourceMedia.map((item) => ({
  ...item,
  src: publicAsset(item.src),
  poster: publicAsset(item.poster),
}));
