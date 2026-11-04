/** Prefix local routes and media when this independent app is hosted below a Pages path. */
export function localPath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return path.startsWith("/") && !path.startsWith("//") ? `${basePath}${path}` : path;
}
