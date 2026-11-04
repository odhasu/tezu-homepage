import { localPath } from "@/lib/local-path";
import { Composer } from "./Composer";
import { SourceIcon } from "./SourceIcon";

export function Hero() {
  return (
    <section className="home-hero">
      <div className="home-grid" aria-hidden="true">
        <img
          className="home-gridLightTop"
          src={localPath("/sites/flashloop/blue/hero-light.svg")}
          alt=""
        />
        <div className="home-gridLightFloor"></div>
        <img
          className="home-gridLines"
          src={localPath("/sites/flashloop/blue/hero-grid.svg")}
          alt=""
        />
        <SourceIcon name="a5f95686d483" />
      </div>
      <div className="home-clouds" aria-hidden="true" data-ready="true">
        <img
          src={localPath("/sites/flashloop/blue/1e4afaae-cloud-a.webp")}
          alt=""
          className="presentation-a8534c1bb"
        />
        <img
          src={localPath("/sites/flashloop/blue/c57e271f-cloud-tuft.webp")}
          alt=""
          className="presentation-96ee4b817"
        />
        <img
          src={localPath("/sites/flashloop/blue/4639d244-cloud-b.webp")}
          alt=""
          className="presentation-cb6141689"
        />
        <img
          src={localPath("/sites/flashloop/blue/1e4afaae-cloud-a.webp")}
          alt=""
          className="presentation-c94502151"
        />
        <img
          src={localPath("/sites/flashloop/blue/1e4afaae-cloud-a.webp")}
          alt=""
          className="presentation-de47f921e"
        />
        <img
          src={localPath("/sites/flashloop/blue/c57e271f-cloud-tuft.webp")}
          alt=""
          className="presentation-5450209c5"
        />
        <img
          src={localPath("/sites/flashloop/blue/4639d244-cloud-b.webp")}
          alt=""
          className="presentation-b1e3c0318"
        />
        <img
          src={localPath("/sites/flashloop/blue/1e4afaae-cloud-a.webp")}
          alt=""
          className="presentation-fb78c29e6"
        />
      </div>
      <div className="home-heroContent">
        <h1>
          {"What will you create"}
          <br />
          {"today?"}
        </h1>
        <Composer />
        <a
          className="home-manual"
          href="https://odhasu.github.io/flashloop-clone/blue/create/video/"
        >
          {"or create manually "}
          <SourceIcon name="0a0ede5646c9" />
        </a>
        <div className="home-rating">
          <div aria-label="Rated 4.7 out of 5">
            <span className="">
              <SourceIcon name="da02f3753866" />
            </span>
            <span className="">
              <SourceIcon name="da02f3753866" />
            </span>
            <span className="">
              <SourceIcon name="da02f3753866" />
            </span>
            <span className="">
              <SourceIcon name="da02f3753866" />
            </span>
            <span className="home-partialStar">
              <SourceIcon name="da02f3753866" />
            </span>
          </div>
          <strong>{"4.7"}</strong>
          <p>
            {"based on 45K reviews on the"}
            <br />
            {"App Store & Google Play"}
          </p>
        </div>
      </div>
    </section>
  );
}

export function CartoonStories() {
  return (
    <section
      className="home-section home-cartoonShowcase"
      aria-labelledby="cartoon-showcase-title"
    >
      <div className="home-cartoonIntro">
        <div>
          <small>{"From the Tezu studio"}</small>
          <h2 className="home-title">
            <span id="cartoon-showcase-title">{"Cartoon stories"}</span>
            <br />
            <em>{"start here"}</em>
          </h2>
        </div>
        <p>
          {
            "Use the same playful worlds for a new image or video, then shape every frame with your prompt."
          }
        </p>
      </div>
      <div className="home-cartoonGrid">
        <a
          className="home-cartoonCard"
          href="https://odhasu.github.io/flashloop-clone/blue/create/video/"
        >
          <img
            src={localPath("/sites/flashloop/cartoon/29c3ff9c-boy-scene.webp")}
            alt="Neon street stories"
            loading="lazy"
            decoding="async"
          />
          <div>
            <h3>{"Neon street stories"}</h3>
            <p>{"Bring a cast to life in a cinematic city scene."}</p>
            <span>
              {"Make one "}
              <SourceIcon name="c7278c6aa3a5" />
            </span>
          </div>
        </a>
        <a
          className="home-cartoonCard"
          href="https://odhasu.github.io/flashloop-clone/blue/create/video/"
        >
          <img
            src={localPath("/sites/flashloop/cartoon/6260e04a-girl-scene.webp")}
            alt="Big-screen animation"
            loading="lazy"
            decoding="async"
          />
          <div>
            <h3>{"Big-screen animation"}</h3>
            <p>{"Make bright, expressive scenes built for sharing."}</p>
            <span>
              {"Make one "}
              <SourceIcon name="c7278c6aa3a5" />
            </span>
          </div>
        </a>
        <a
          className="home-cartoonCard"
          href="https://odhasu.github.io/flashloop-clone/blue/create/image/"
        >
          <img
            src={localPath("/sites/flashloop/cartoon/262995c6-boy.png")}
            alt="Your next visual world"
            loading="lazy"
            decoding="async"
          />
          <div>
            <h3>{"Your next visual world"}</h3>
            <p>{"Start with an image, then take it anywhere."}</p>
            <span>
              {"Make one "}
              <SourceIcon name="c7278c6aa3a5" />
            </span>
          </div>
        </a>
      </div>
    </section>
  );
}

export function Models() {
  return (
    <div className="home-section">
      <section className="presentation-963834915 home-models">
        <div>
          <h2 className="home-title">
            {"Global models"}
            <br />
            <em>{"access"}</em>
          </h2>
          <p>
            {
              "Access the latest highest quality AI models in one place. Break free from multiple subscriptions and leverage expert-built libraries of tools tailored for every creative need."
            }
          </p>
          <a
            className="home-button"
            href="https://odhasu.github.io/flashloop-clone/blue/models/"
          >
            {"Explore all models"}
            <SourceIcon name="9273b0145860" />
          </a>
        </div>
        <div className="presentation-1728d3d30 home-modelPanel">
          <div className="home-modelTrack">
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-0.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Kling 4.0"}</span>
              <b className="home-modelBadge">{"New"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-1.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Kling 3.0"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-2.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Sora 2"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-3.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Seedance 2.5"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-4.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Veo 3.1"}</span>
              <b className="home-modelBadge">{"Unlimited"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-5.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Wan 3.0"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-6.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Grok Imagine 1.5"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-7.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"MiniMax Hailuo 3"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-8.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Gemini Omni"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-9.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Nano Banana 2.1"}</span>
              <b className="home-modelBadge">{"Unlimited"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-10.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Nano Banana Pro"}</span>
              <b className="home-modelBadge">{"Unlimited"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-11.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"GPT Image 2"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-12.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Flux 2"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-0.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Kling 4.0"}</span>
              <b className="home-modelBadge">{"New"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-1.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Kling 3.0"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-2.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Sora 2"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-3.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Seedance 2.5"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-4.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Veo 3.1"}</span>
              <b className="home-modelBadge">{"Unlimited"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-5.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Wan 3.0"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-6.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Grok Imagine 1.5"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-7.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"MiniMax Hailuo 3"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-8.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Gemini Omni"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-9.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Nano Banana 2.1"}</span>
              <b className="home-modelBadge">{"Unlimited"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-10.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Nano Banana Pro"}</span>
              <b className="home-modelBadge">{"Unlimited"}</b>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-11.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"GPT Image 2"}</span>
            </div>
            <div>
              <img
                src={localPath("/sites/flashloop/graphics/model-12.svg")}
                alt=""
                loading="lazy"
              />
              <span>{"Flux 2"}</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function AssistantPromo() {
  return (
    <div className="home-section">
      <section
        className="mcp-section"
        data-visible="true"
        aria-label="Flashloop in your assistant"
      >
        <div role="tabpanel" tabIndex={0} className="mcp-panel">
          <div className="mcp-card">
            <div className="mcp-rays" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div className="mcp-heading">
              <span className="mcp-brandIcon" aria-hidden="true">
                <img
                  src={localPath("/sites/flashloop/mcp/chatgpt-mcp-icon.webp")}
                  width="48"
                  height="48"
                  alt=""
                  loading="lazy"
                />
              </span>
              <h2>
                {"Get Flashloop into "}
                {"ChatGPT"}
              </h2>
            </div>
            <div className="mcp-stage">
              <div className="mcp-details">
                <p>
                  {"Image, video and voice tools."}
                  <br />
                  {"Right inside "}
                  {"ChatGPT"}
                  {", in three simple steps."}
                </p>
                <a
                  className="mcp-cta"
                  href="https://odhasu.github.io/flashloop-clone/blue/mcp/?tab=chatgpt#connect"
                >
                  <img
                    src={localPath("/sites/flashloop/mcp/chatgpt.svg")}
                    width="28"
                    height="28"
                    alt=""
                    draggable="false"
                    loading="lazy"
                  />
                  {"Add to ChatGPT"}
                  <SourceIcon name="3a8bd2bcfe94" />
                </a>
              </div>
              <div className="mcp-preview" aria-hidden="true">
                <div className="mcp-browserChrome">
                  <span>
                    <i></i>
                    <i></i>
                    <i></i>
                  </span>
                  <b>{"flashloop.ai"}</b>
                  <span>{"\uff0b"}</span>
                </div>
                <div className="mcp-previewHeader">
                  <span>
                    <SourceIcon name="8374a779758d" />
                    {" Flashloop"}
                  </span>
                  <span>{"Your creative workspace"}</span>
                </div>
                <div className="mcp-previewBody">
                  <div className="mcp-mediaCard">
                    <span className="mcp-mediaLabel">
                      <SourceIcon name="47d8d13c9754" />
                      {"Image"}
                    </span>
                    <img
                      src={localPath("/sites/flashloop/850800ee-studio_white--dewvana-hero.webp")}
                      width="640"
                      height="800"
                      alt=""
                      loading="lazy"
                    />
                    <span className="mcp-mediaCaption">
                      {"Start with your vision"}
                    </span>
                  </div>
                  <div className="mcp-mediaCard">
                    <span className="mcp-mediaLabel">
                      <SourceIcon name="e86593729108" />
                      {"Video"}
                    </span>
                    <img
                      src={localPath("/sites/flashloop/2634b3e2-hero-night-market-lg.webp")}
                      width="800"
                      height="450"
                      alt=""
                      loading="lazy"
                    />
                    <span className="mcp-play">{"\u25b6"}</span>
                    <span className="mcp-mediaCaption">
                      {"Bring a scene to life"}
                    </span>
                  </div>
                  <div className="mcp-mediaCard mcp-voiceCard">
                    <span className="mcp-mediaLabel">
                      <SourceIcon name="e4072a1ae87e" />
                      {"Voice"}
                    </span>
                    <div className="mcp-waveform">
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                    <span className="mcp-voiceText">
                      {"Give your story"}
                      <br />
                      {"a voice."}
                    </span>
                    <span className="mcp-mediaCaption">
                      {"Find the right tone"}
                    </span>
                  </div>
                </div>
                <div className="mcp-previewGenerations">
                  <strong>{"Your generations"}</strong>
                  <span>{"Pick up where you left off."}</span>
                  <div>
                    <img
                      src={localPath("/sites/flashloop/850800ee-studio_white--dewvana-hero.webp")}
                      alt=""
                      loading="lazy"
                    />
                    <img
                      src={localPath("/sites/flashloop/2634b3e2-hero-night-market-lg.webp")}
                      alt=""
                      loading="lazy"
                    />
                    <img
                      src={localPath("/sites/flashloop/850800ee-studio_white--dewvana-hero.webp")}
                      alt=""
                      loading="lazy"
                    />
                    <img
                      src={localPath("/sites/flashloop/2634b3e2-hero-night-market-lg.webp")}
                      alt=""
                      loading="lazy"
                    />
                  </div>
                </div>
                <div className="mcp-previewPrompt">
                  <span>{"Describe your next idea\u2026"}</span>
                  <span>
                    <SourceIcon name="ec3d0b1b2863" />
                    {" Flashloop MCP"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function Studio() {
  return (
    <div className="home-section home-studio">
      <a
        className="presentation-963834915 home-studioMain"
        href="https://odhasu.github.io/flashloop-clone/blue/effects/"
      >
        <img
          src={localPath("/sites/flashloop/642253f5-studio-cast-tiles.webp")}
          alt=""
          loading="lazy"
        />
        <div>
          <h2>{"Flashloop Studio"}</h2>
          <p>
            {
              "Recurring characters, series built to binge, and audiences that come back."
            }
          </p>
        </div>
        <span className="home-button">
          {"Try now "}
          <SourceIcon name="28aa5160394f" />
        </span>
      </a>
      <div className="home-studioCards">
        <a href="https://odhasu.github.io/flashloop-clone/blue/create/video/?model=kling-4.0">
          <img
            src={localPath("/sites/flashloop/graphics/studio-0.svg")}
            alt=""
            loading="lazy"
          />
          <SourceIcon name="9273b0145860" />
          <div>
            <h3>{"Kling 4.0"}</h3>
            <p>{"Now available on Flashloop"}</p>
          </div>
        </a>
        <a href="https://odhasu.github.io/flashloop-clone/blue/create/image/?model=gpt-image-2.5">
          <img
            src={localPath("/sites/flashloop/graphics/studio-1.svg")}
            alt=""
            loading="lazy"
          />
          <SourceIcon name="9273b0145860" />
          <div>
            <h3>{"Create images"}</h3>
            <p>{"with GPT Image 2.5"}</p>
          </div>
        </a>
        <a href="https://odhasu.github.io/flashloop-clone/blue/create/image/?model=nano-banana-2">
          <img
            src={localPath("/sites/flashloop/graphics/studio-2.svg")}
            alt=""
            loading="lazy"
          />
          <SourceIcon name="9273b0145860" />
          <div>
            <h3>{"Edit by typing"}</h3>
            <p>{"with Nano Banana 2.1"}</p>
          </div>
        </a>
        <a href="https://odhasu.github.io/flashloop-clone/blue/mcp/">
          <img src={localPath("/sites/flashloop/blue/studio-3.svg")} alt="" loading="lazy" />
          <SourceIcon name="9273b0145860" />
          <div>
            <h3>{"Connect your agent"}</h3>
            <p>{"with Flashloop MCP"}</p>
          </div>
        </a>
        <a href="https://odhasu.github.io/flashloop-clone/blue/characters/">
          <img
            src={localPath("/sites/flashloop/graphics/studio-4.svg")}
            alt=""
            loading="lazy"
          />
          <SourceIcon name="9273b0145860" />
          <div>
            <h3>{"Create your cast"}</h3>
            <p>{"with Characters"}</p>
          </div>
        </a>
        <a href="https://odhasu.github.io/flashloop-clone/blue/create/video/?model=seedance-2.5">
          <img
            src={localPath("/sites/flashloop/graphics/studio-5.svg")}
            alt=""
            loading="lazy"
          />
          <SourceIcon name="9273b0145860" />
          <div>
            <h3>{"Create videos"}</h3>
            <p>{"with Seedance 2.5"}</p>
          </div>
        </a>
      </div>
    </div>
  );
}

export function FormatsHeading() {
  return (
    <div className="home-section">
      <h2 className="home-title">
        {"Explore top formats from"}
        <br />
        <em>{"creators and brands"}</em>
      </h2>
    </div>
  );
}

export function Audiences() {
  return (
    <div className="home-section home-audiences">
      <small>{"Who it's for"}</small>
      <h2 className="home-title">{"Built for teams that ship viral"}</h2>
      <p>
        {
          "From in-house marketers to full-service agencies, Flashloop is the unfair advantage behind the feed."
        }
      </p>
      <div>
        <article>
          <img
            src={localPath("/sites/flashloop/39a50820-audience-marketing.webp")}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <h3>{"Marketing Teams"}</h3>
          <p>
            {
              "Fill the content calendar with formats proven to pull views. No crew, no shoot days, no edit bay. Ship daily, learn fast."
            }
          </p>
        </article>
        <article>
          <img
            src={localPath("/sites/flashloop/15156e7b-audience-agency.webp")}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <h3>{"Agencies"}</h3>
          <p>
            {
              "Jump on a trend the day it breaks. Pitch and deliver client work built on formats already pulling millions of views."
            }
          </p>
        </article>
        <article>
          <img
            src={localPath("/sites/flashloop/b267b821-audience-creator.webp")}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <h3>{"Creators"}</h3>
          <p>
            {
              "Ride every wave first. New viral formats land constantly, so your channel never misses a trend worth posting."
            }
          </p>
        </article>
      </div>
    </div>
  );
}

export function CreatorBanner() {
  return (
    <section className="home-section home-creatorBanner">
      <div>
        <small>{"Make videos the internet can't ignore"}</small>
        <h2 className="home-title">
          {"Looking for our"}
          <br />
          <span>{"creator program?"}</span>
        </h2>
      </div>
      <a
        className="home-button"
        href="https://odhasu.github.io/flashloop-clone/blue/creators/"
      >
        {"Get the instructions"}
        <SourceIcon name="28aa5160394f" />
      </a>
    </section>
  );
}
