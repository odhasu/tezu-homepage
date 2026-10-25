"use client";

/* Original source logo is served locally at its exact dimensions. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Clapperboard, Gem, ImageIcon, Menu, MessageSquare, UserRound, X } from "lucide-react";
import { asset } from "./assets";
import { PageMotion } from "./PageMotion";
import { MobileCta } from "./MobileCta";
import { CookieSettingsButton } from "./PrivacyControls";
import { focusCharacterPlanner } from "./planner-navigation";
import { publicContact } from "@/lib/public-contact";

const mainLinks = [
  ["Pricing", "/pricing"],
  ["Hire Us", "/hire"],
  ["About", "/about"],
];
const productLinks = [
  { title: "Cartoon Maker", href: "/#tools", description: "Start with a character, then build a story", icon: UserRound },
  { title: "Image", href: "/create/image", description: "Turn your ideas into images", icon: ImageIcon },
  { title: "Video", href: "/create/video", description: "Bring your scenes to life", icon: Clapperboard },
  { title: "MCP", href: "/#mcp", description: "Create with your assistant · Coming soon", icon: MessageSquare },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const [menu, setMenu] = useState(false);
  const [account, setAccount] = useState(false);
  const [product, setProduct] = useState(false);
  const productNav = useRef<HTMLDivElement>(null);
  const productButton = useRef<HTMLButtonElement>(null);
  const isHome = pathname === "/";
  const isAuth = pathname === "/auth";
  const hasQuickNav = isHome || ["/pricing", "/about", "/hire", "/privacy", "/terms", "/cookies", "/intro-preview"].includes(pathname);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (productNav.current?.contains(document.activeElement)) productButton.current?.focus();
        setProduct(false);
        setMenu(false);
        setAccount(false);
      }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !productNav.current?.contains(event.target)) setProduct(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, []);
  function closeNavigation() { setMenu(false); setProduct(false); setAccount(false); }
  if (isAuth) return children;
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <Link href="/" className="site-logo" aria-label="TEZU home" onClick={closeNavigation}><img src={asset("tezu-white-knot-logo.png")} alt="TEZU" width="40" height="40" /><span>TEZU</span></Link>
        <nav className="desktop-nav" aria-label="Main">
          <div className="product-nav" ref={productNav} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setProduct(false); }}>
            <button ref={productButton} className="product-trigger" type="button" aria-expanded={product} aria-controls="product-links" onClick={() => setProduct(!product)}>Product<ChevronDown size={14} aria-hidden="true" /></button>
            {product && <div className="product-links" id="product-links">{productLinks.map(({ title, href, description, icon: Icon }) => <Link key={href} href={href} onClick={closeNavigation}><Icon size={20} aria-hidden="true" /><span>{title}<small>{description}</small></span></Link>)}</div>}
          </div>
          {mainLinks.map(([title, href]) => <Link key={href} href={href} className={pathname === href ? "active" : ""} aria-current={pathname === href ? "page" : undefined} onClick={closeNavigation}>{title}</Link>)}
        </nav>
        <div className="header-actions">
          {hasQuickNav ? <><Link href="/auth" className="header-login-button" onClick={closeNavigation}>Log in</Link><Link href="/#tools" className="primary-button header-create-button" onClick={(event) => { closeNavigation(); focusCharacterPlanner(event); }}>Start creating<ArrowRight size={15} aria-hidden="true" /></Link></> : <Link href="/settings" className="credit-pill" aria-label="Credit balance"><Gem size={17} /><b>20</b><span>credits</span></Link>}
          {!hasQuickNav && <div className="account-wrap"><button className="account-button" aria-label="Account menu" aria-expanded={account} onClick={() => setAccount(!account)}>O</button>{account && <div className="account-menu" onClick={() => setAccount(false)}><Link href="/settings">Settings</Link><Link href="/characters">My Characters</Link><Link href="/creations">My Creations</Link><Link href="/rewards">Rewards</Link><Link href="/auth">Log in</Link></div>}</div>}
          <button className="mobile-menu-button icon-button" aria-label={menu ? "Close menu" : "Open menu"} aria-controls="mobile-navigation" aria-expanded={menu} onClick={() => { setMenu(!menu); setAccount(false); }}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </header>
      {menu && <><button aria-label="Close navigation" className="menu-backdrop" onClick={closeNavigation} /><nav id="mobile-navigation" className="mobile-menu" aria-label="Mobile navigation"><details className="mobile-products" open><summary>Product<ChevronDown size={15} aria-hidden="true" /></summary><div>{productLinks.map(({ title, href, icon: Icon }) => <Link key={href} href={href} onClick={closeNavigation}><Icon size={17} aria-hidden="true" />{title}<ArrowRight size={15} aria-hidden="true" /></Link>)}</div></details>{[mainLinks[1], mainLinks[0], mainLinks[2]].map(([name, href]) => <Link key={href} href={href} onClick={closeNavigation}>{name}<ArrowRight size={15} aria-hidden="true" /></Link>)}</nav></>}
      <div id={isHome ? undefined : "main-content"} tabIndex={isHome ? undefined : -1} className={`site-content ${isHome ? "home-content" : ""} ${hasQuickNav ? "has-mobile-cta" : ""}`}>{children}{["/about", "/hire", "/privacy", "/terms", "/cookies"].includes(pathname) && <Footer />}</div>
      <PageMotion />
      {hasQuickNav && <MobileCta hire={pathname === "/hire"} />}
    </>
  );
}

export function Footer() {
  return <footer className="site-footer"><div className="footer-grid"><div className="footer-brand"><img src={asset("tezu-white-knot-logo.png")} width="43" height="43" alt="TEZU" /><b>TEZU</b><p>Your cast, your scenes, your next cartoon story.</p><a href={publicContact.instagram} target="_blank" rel="noreferrer">{publicContact.handle} ↗</a></div>{[
    ["Product", ["Character Creator", "/create/character"], ["Image Generator", "/create/image"], ["Video Generator", "/create/video"], ["Explore", "/#explore"]],
    ["Account", ["Pricing", "/pricing"], ["Log in", "/auth"], ["Sign up", "/auth?mode=signup"], ["Open Studio", "/create/image"]],
    ["Company", ["About", "/about"], ["Hire TEZU", "/hire"], ["FAQ", "/#faq"], ["Contact", "/hire#inquiry"]],
    ["Legal", ["Privacy Policy", "/privacy"], ["Terms of Service", "/terms"], ["Cookie Policy", "/cookies"]],
  ].map(([title, ...items]) => <div className="footer-column" key={title as string}><h3>{title as string}</h3>{items.map(item => <Link key={item[1]} href={item[1]}>{item[0]}</Link>)}</div>)}</div><div className="footer-bottom">© 2026 TEZU. All rights reserved.<CookieSettingsButton /></div></footer>;
}
