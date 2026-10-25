import manifest from "../../../../public/sites/tezu/manifest.json";

export function asset(name: string): string {
  const path = name.startsWith("model-") ? `/sites/tezu/${name}` : (manifest as Record<string, string>)[name] ?? name;
  return path.startsWith("/") ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}` : path;
}
