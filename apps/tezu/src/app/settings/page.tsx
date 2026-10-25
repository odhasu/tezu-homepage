import { pageMetadata } from "@/lib/site-metadata";
import { SettingsPage } from "@/components/sites/tezu/library-pages";
export const metadata = pageMetadata("Settings & Credits · TEZU", "Manage your local TEZU profile preferences and review preview credits and account settings.", "/settings", false);
export default function Page() { return <SettingsPage />; }
