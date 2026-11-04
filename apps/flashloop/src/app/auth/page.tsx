import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Sign in | Flashloop" };

export default function AuthPage() {
  return <AuthForm />;
}
