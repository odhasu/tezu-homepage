"use client";

import { localPath } from "@/lib/local-path";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { Media, type MediaItem } from "./Media";
import content from "./content.json";

export function Releases() {
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  function show(index: number) {
    const next = (index + content.releases.length) % content.releases.length;
    setActive(next);
    const card = track.current?.children[next] as HTMLElement | undefined;
    track.current?.scrollTo({
      left: card?.offsetLeft ?? 0,
      behavior: "smooth",
    });
  }
  return (
    <section className="home-releases">
      <div className="home-sectionHeading">
        <h2 className="home-title">
          Latest <em>arrivals</em>
        </h2>
        <div>
          <button
            aria-label="Previous release"
            onClick={() => show(active - 1)}
          >
            <Icon name="chevron" className="rotate-left" />
          </button>
          <button aria-label="Next release" onClick={() => show(active + 1)}>
            <Icon name="chevron" />
          </button>
        </div>
      </div>
      <div className="home-releaseViewport">
        <div className="release-scroll" ref={track}>
          {content.releases.map((item) => (
            <a className="home-release" key={item.title} href={item.href}>
              <div>
                <Media item={item} />
                <div className="home-releaseCopy">
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
      <div className="home-dots">
        {content.releases.map((item, index) => (
          <button
            key={item.title}
            aria-label={`Show ${item.title}`}
            aria-pressed={active === index}
            onClick={() => show(index)}
          />
        ))}
      </div>
    </section>
  );
}

type Preview = MediaItem & { title: string };
export function ShowcaseRails() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (preview) dialog.current?.showModal();
  }, [preview]);
  return (
    <>
      <section className="home-rails" aria-label="Creator examples">
        {content.rails.map((row, i) => (
          <div className="home-railViewport" key={i}>
            <div className={`home-railTrack ${i === 1 ? "rail-reverse" : ""}`}>
              {[...row, ...row].map((item, j) => (
                <button
                  key={`${item.title}-${j}`}
                  className={`home-railCard ${item.aspect === "16/9" ? "rail-landscape" : "rail-portrait"}`}
                  aria-hidden={j >= row.length ? true : undefined}
                  tabIndex={j >= row.length ? -1 : 0}
                  onClick={() => setPreview(item)}
                >
                  <Media item={item} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
      <dialog
        ref={dialog}
        className="media-dialog"
        onClose={() => setPreview(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        {preview && (
          <>
            <button
              aria-label="Close preview"
              className="dialog-close"
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
            <video
              src={preview.src ? localPath(preview.src) : undefined}
              poster={localPath(preview.poster)}
              controls
              autoPlay
              playsInline
            />
            <h2>{preview.title}</h2>
          </>
        )}
      </dialog>
    </>
  );
}

export function Formats() {
  const [active, setActive] = useState(0);
  const root = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const isClicking = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const query = window.matchMedia(
      "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    function update() {
      if (!element || !query.matches || isClicking.current) return;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      const progress = Math.min(
        1,
        Math.max(0, -rect.top / (rect.height - window.innerHeight)),
      );
      const index = Math.min(
        content.formats.length - 1,
        Math.floor(progress * content.formats.length),
      );
      setActive(index);
      const height = viewport.current?.clientHeight ?? 405;
      if (rows.current)
        rows.current.style.transform = `translateY(${-index * height}px)`;
    }
    function scroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", scroll);
    query.addEventListener("change", scroll);
    update();
    return () => {
      cancelAnimationFrame(frame);
      if (clickTimer.current) clearTimeout(clickTimer.current);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", scroll);
      query.removeEventListener("change", scroll);
    };
  }, []);
  function choose(index: number) {
    setActive(index);
    if (rows.current)
      rows.current.style.transform = `translateY(${-index * (viewport.current?.clientHeight ?? 405)}px)`;
    if (
      !window.matchMedia(
        "(min-width: 768px) and (prefers-reduced-motion: no-preference)",
      ).matches ||
      !root.current
    )
      return;
    isClicking.current = true;
    const rect = root.current.getBoundingClientRect();
    window.scrollTo({
      top:
        window.scrollY +
        rect.top +
        ((index + 0.35) / content.formats.length) *
          (rect.height - window.innerHeight),
      behavior: "smooth",
    });
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => {
      isClicking.current = false;
    }, 900);
  }
  return (
    <section className="home-formats" ref={root}>
      <div className="home-formatsSticky">
        <div className="home-formatsHeading">
          <h2 className="home-title">
            See what you can produce on <em>Flashloop</em>
          </h2>
        </div>
        <div className="home-formatLayout">
          <div className="home-formatCopy">
            <div>
              {content.formats.map((item, index) => (
                <div
                  key={item.title}
                  className={index === active ? "home-formatActive" : ""}
                >
                  <button
                    aria-expanded={active === index}
                    aria-controls={`format-description-${index}`}
                    onClick={() => choose(index)}
                  >
                    {item.title}
                  </button>
                  <div
                    className="home-formatDetails"
                    id={`format-description-${index}`}
                    inert={index !== active}
                  >
                    <p>{item.description}</p>
                    <a href={item.href}>
                      Create this <Icon name="arrow" width="14" height="14" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="home-formatViewport" ref={viewport}>
            <div className="home-formatRows" ref={rows}>
              {content.formats.map((item, index) => (
                <div
                  className="home-formatRow"
                  key={item.title}
                  data-active={index === active}
                  aria-hidden={index !== active}
                >
                  {item.media.map((media, i) => (
                    <div key={i}>
                      <Media item={media} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Trends() {
  return (
    <div className="home-section">
      <div className="home-trendHeading">
        <div>
          <h2 className="home-title">
            Top <em>Trends</em>
          </h2>
          <p>
            Effects riding the biggest AI trends right now, ready in one click.
          </p>
        </div>
        <a href="https://odhasu.github.io/flashloop-clone/blue/effects/">
          See all <Icon name="arrow" />
        </a>
      </div>
      <div className="home-trends">
        {content.trends.map((item) => (
          <Trend key={item.title} item={item} />
        ))}
      </div>
    </div>
  );
}
function Trend({ item }: { item: (typeof content.trends)[number] }) {
  const [index, setIndex] = useState(0);
  return (
    <article>
      <a href={item.href}>
        <img
          src={localPath(item.posters[index])}
          alt={item.title}
          loading="lazy"
          decoding="async"
        />
      </a>
      {item.posters.length > 1 && (
        <button
          className="home-trendNext"
          aria-label={`Next ${item.title} example`}
          onClick={() => setIndex((index + 1) % item.posters.length)}
        >
          <Icon name="chevron" width="14" height="14" />
        </button>
      )}
      <p>{item.title}</p>
    </article>
  );
}

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="home-section home-faq">
      <h2 className="home-title">
        Frequently asked <em>questions</em>
      </h2>
      <div>
        <div className="home-questions">
          {content.faq.map((item, index) => (
            <article
              key={item.question}
              className={open === index ? "home-faqOpen" : ""}
            >
              <button
                aria-expanded={open === index}
                aria-controls={`faq-${index}`}
                onClick={() => setOpen(open === index ? null : index)}
              >
                {item.question}
                <Icon name="plus" width="20" height="20" />
              </button>
              <div
                className="home-faqAnswer"
                id={`faq-${index}`}
                inert={open !== index}
              >
                <div>
                  <p>{item.answer}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div className="home-faqContact">
          <p>
            Can&apos;t find your answer? Write to us and we&apos;ll answer it
            ourselves.
          </p>
          <a href="https://odhasu.github.io/flashloop-clone/blue/contact/">
            Get in touch <Icon name="diagonal" />
          </a>
        </div>
      </div>
    </section>
  );
}
