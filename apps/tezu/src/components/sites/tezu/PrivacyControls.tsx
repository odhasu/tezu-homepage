"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { SlidersHorizontal } from "lucide-react";
import { getPrivacySnapshot, parsePrivacy, savePrivacy, subscribePrivacy } from "./privacy-preferences";

export function CookieSettingsButton() {
  return <button type="button" className="cookie-settings-link" onClick={() => window.dispatchEvent(new Event("tezu:privacy-open"))}>Cookie settings</button>;
}

export function PrivacyControls() {
  const stored = useSyncExternalStore(subscribePrivacy, getPrivacySnapshot, () => null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const open = () => setEditing(true);
    window.addEventListener("tezu:privacy-open", open);
    return () => window.removeEventListener("tezu:privacy-open", open);
  }, []);
  if (parsePrivacy(stored) && !editing) return null;
  return <section className="privacy-banner" aria-label="Cookie preferences">
    <div className="privacy-banner-heading"><SlidersHorizontal size={19} aria-hidden="true" /><h2>Your space. Your choice.</h2></div>
    <p>This preview uses essential local storage for your display name and this notice. No analytics or advertising trackers. <Link href="/cookies">Storage details</Link></p>
    <button className="privacy-dismiss" type="button" onClick={() => { savePrivacy(); setEditing(false); }}>Got it</button>
  </section>;
}
