import type { Metadata } from "next";
import { MotionControlPage } from "../../components/sites/krea/MotionControlPage";

export const metadata: Metadata = {
  title: "Motion control — Tezu",
  description: "Explore a motion reference and its viral result with an interactive video comparison.",
};

export default function Page() {
  return <MotionControlPage />;
}
