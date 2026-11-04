"use client";

import { localPath } from "@/lib/local-path";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { referenceLink } from "@/lib/links";
import content from "./content.json";

const nav = [
  ["Explore", ""],
  ["Image", "create/image/"],
  ["Video", "create/video/"],
  ["MCP", "mcp/"],
  ["Creator Program", "creators/"],
];

export function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menu.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
      if (event.key === "Tab") {
        const links = menu.current?.querySelectorAll<HTMLAnchorElement>("a");
        if (!links?.length) return;
        const first = links[0],
          last = links[links.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          toggle.current?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          toggle.current?.focus();
        } else if (document.activeElement === toggle.current) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  return (
    <header className="shell-header">
      <div className="shell-bar">
        <nav className="shell-navigation" aria-label="Primary navigation">
          <a className="shell-logo" href={localPath("/blue/")} aria-label="Flashloop – home">
            <img
              src={localPath("/sites/flashloop/blue/acda2036-logo-wordmark.webp")}
              alt="Flashloop.AI"
              width="170"
              height="28"
              fetchPriority="high"
            />
          </a>
          <div className="shell-desktopLinks">
            {nav.map(([label, path]) => (
              <div key={label} className="shell-navItem">
                <a
                  className={path ? "" : "shell-active"}
                  href={path ? referenceLink(path) : localPath("/blue/")}
                >
                  {label}
                </a>
              </div>
            ))}
          </div>
          <div className="shell-actions">
            <a className="shell-tryNow" href={referenceLink("auth/")}>Get Started</a>
            <div className="shell-desktopActions">
            <a className="shell-pricing" href={referenceLink("pricing/")}>
              <i />
              <b>Pricing</b>
              <span>30% OFF</span>
            </a>
            <a className="shell-login" href={referenceLink("auth/")}>
              Login
            </a>
            <a className="shell-signup" href={referenceLink("auth/")}>
              Sign up
            </a>
            </div>
            <button
              ref={toggle}
              className="shell-mobileToggle"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-navigation"
              onClick={() => setOpen(!open)}
            >
              <Icon name={open ? "close" : "menu"} />
            </button>
          </div>
        </nav>
      </div>
      {open && (
        <div className="mobile-menu" ref={menu} id="mobile-navigation">
          <nav aria-label="Mobile navigation">
            {nav.map(([label, path]) => (
              <a
                key={label}
                href={path ? referenceLink(path) : localPath("/blue/")}
                onClick={() => setOpen(false)}
              >
                {label}
                <Icon name="diagonal" />
              </a>
            ))}
            <a href={referenceLink("pricing/")}>
              Pricing <span>30% OFF</span>
            </a>
            <a href={referenceLink("auth/")}>Login / Sign up</a>
          </nav>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <>
      <footer className="shell-footer">
        <div className="shell-footerContainer">
          <div className="shell-footerContent">
            <div className="shell-footerTop">
              <h2>AI Creation Suite Powering Top Creators</h2>
              <div className="shell-footerGrid">
                {[[0, 1], [2], [3], [4, 5], [6]].map((indexes, column) => (
                  <div className="shell-footerStack" key={column}>
                    {indexes.map((index) => {
                      const group = content.footer[index];
                      return (
                        <section
                          className="shell-footerGroup"
                          key={group.title}
                        >
                          <h3>{group.title}</h3>
                          <ul>
                            {group.links.map((link) => (
                              <li key={link.href}>
                                <a href={localPath(link.href)}>
                                  <span>{link.label}</span>
                                  <Icon
                                    name="pixel"
                                    className="shell-pixelArrow"
                                  />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div className="footer-address">
                <p>2355 RUE DES ÉQUINOXES, SUITE 318, H4R 0S2 MONTRÉAL, QC</p>
                <div>
                  {[
                    ["TikTok", "https://www.tiktok.com/@flashloop_app"],
                    ["Instagram", "https://www.instagram.com/flashloop_app"],
                    ["YouTube", "https://www.youtube.com/@flashloop_app"],
                    ["X", "https://x.com/flashloop_ai"],
                  ].map(([name, href]) => (
                    <a href={href} key={name}>
                      {name}
                      <Icon name="diagonal" width="14" height="14" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="shell-footerWordmark" aria-label="Flashloop">
          <span>Flashloop</span>
        </div>
      </footer>
      <div className="legal-footer">
        <span>© 2026 Flashloop. All rights reserved.</span>
        <nav aria-label="Legal">
          {content.footer
            .find((group) => group.title === "Legal")
            ?.links.map((link) => (
              <a href={localPath(link.href)} key={link.label}>
                {link.label}
              </a>
            ))}
        </nav>
      </div>
    </>
  );
}
