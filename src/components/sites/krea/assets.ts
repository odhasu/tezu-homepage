import sourceMedia from "./tezu-media.json";
import { publicAsset, thumbnailFor } from "./asset-urls";

export const tezuMedia = sourceMedia.map((item) => ({
  ...item,
  src: publicAsset(item.src),
  poster: publicAsset(item.poster),
  thumbnail: thumbnailFor(item.poster),
}));
