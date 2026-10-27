export function resolveTezuAppHome({ development, basePath = "", override }: { development: boolean; basePath?: string; override?: string }): string {
  if (override?.trim()) {
    try {
      const url = new URL(override.trim());
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) {
        url.search = "";
        url.hash = "";
        return `${url.toString().replace(/\/+$/, "")}/`;
      }
    } catch { /* Preserve existing destinations when an override is invalid. */ }
  }
  return development ? "http://127.0.0.1:3000/" : `${basePath.replace(/\/+$/, "")}/tezu/`;
}

export const tezuAppHome = resolveTezuAppHome({
  development: process.env.NODE_ENV === "development",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  override: process.env.NEXT_PUBLIC_TEZU_APP_URL,
});
