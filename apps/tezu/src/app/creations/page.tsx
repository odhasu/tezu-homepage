import { pageMetadata } from "@/lib/site-metadata";
import { CreationsPage } from "@/components/sites/tezu/library-pages";
export const metadata = pageMetadata("My Creations · TEZU", "Explore your TEZU creation library and find inspiration for images, animated scenes, and character stories.", "/creations", false);
export default function Page() { return <CreationsPage />; }
