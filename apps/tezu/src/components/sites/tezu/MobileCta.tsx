"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { focusCharacterPlanner } from "./planner-navigation";

export function MobileCta({ hire = false }: { hire?: boolean }) {
  return <aside className="mobile-primary-cta" aria-label={hire ? "Start your project" : "Start creating"}><span>{hire ? "Your story. Our studio." : "Your next story starts here."}</span><Link href={hire ? "/hire#inquiry" : "/#tools"} className="primary-button" onClick={hire ? undefined : focusCharacterPlanner}>{hire ? "Build your brief" : "Start creating"}<ArrowUpRight size={16} aria-hidden="true" /></Link></aside>;
}
