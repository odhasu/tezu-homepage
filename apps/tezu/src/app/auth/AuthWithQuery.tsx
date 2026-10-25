"use client";

import { useSearchParams } from "next/navigation";
import { AuthPage } from "@/components/sites/tezu/secondary-pages";

export function AuthWithQuery() {
  const mode = useSearchParams().get("mode") ?? "login";
  return <AuthPage key={mode} mode={mode} />;
}
