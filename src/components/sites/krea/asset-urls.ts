import mediaThumbnails from "./media-thumbnails.json";

export function publicAsset(path: string) {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}

/** Display derivatives only; original media URLs remain available for references and previews. */
export function thumbnailFor(path: string) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const original = basePath && path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
  const thumbnail = mediaThumbnails[original as keyof typeof mediaThumbnails];
  return thumbnail ? publicAsset(thumbnail) : path;
}
