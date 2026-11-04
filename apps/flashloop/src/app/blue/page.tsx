import { Header, Footer } from "@/components/sites/flashloop/SiteShell";
import {
  Hero,
  CartoonStories,
  Models,
  AssistantPromo,
  Studio,
  FormatsHeading,
  Audiences,
  CreatorBanner,
} from "@/components/sites/flashloop/Sections";
import {
  Releases,
  ShowcaseRails,
  Formats,
  Trends,
  Faq,
} from "@/components/sites/flashloop/Galleries";
import { MotionVisibility } from "@/components/sites/flashloop/MotionVisibility";

export default function FlashloopPage() {
  return (
    <div className="shell-app">
      <Header />
      <main id="main-content" className="shell-main">
        <div className="home-home">
          <Hero />
          <Releases />
          <CartoonStories />
          <Models />
          <AssistantPromo />
          <Studio />
          <FormatsHeading />
          <ShowcaseRails />
          <Audiences />
          <Formats />
          <Trends />
          <Faq />
          <CreatorBanner />
        </div>
      </main>
      <Footer />
      <MotionVisibility />
    </div>
  );
}
