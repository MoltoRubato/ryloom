import { type Metadata } from "next";

import { Features } from "@/components/marketing/features";
import { GetStarted } from "@/components/marketing/get-started";
import { Hero } from "@/components/marketing/hero";
import { Workflow } from "@/components/marketing/workflow";

export const metadata: Metadata = {
  title: { absolute: "Ryloom — Screen recording for macOS" },
  description:
    "A focused screen recorder for teams. Capture, share, and track — with no friction in between. Download Ryloom for macOS.",
};

export default function MarketingHomePage() {
  return (
    <>
      <Hero />
      <Features />
      <Workflow />
      <GetStarted />
    </>
  );
}
