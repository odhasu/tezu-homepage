import { pageMetadata } from "@/lib/site-metadata";
import { CharactersPage } from "@/components/sites/tezu/library-pages";
export const metadata = pageMetadata("My Characters · TEZU", "Manage character references and explore the cast for your next TEZU story.", "/characters", false);
export default function Page() { return <CharactersPage />; }
