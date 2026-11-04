import type { Metadata } from "next";
import { SessionVerification } from "@/components/auth/SessionVerification";

export const metadata: Metadata = { title: "Verify your account | Flashloop" };

export default function VerifyAccountPage() {
  return <SessionVerification />;
}
