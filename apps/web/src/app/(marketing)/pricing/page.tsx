import { type Metadata } from "next";

import { PricingContent } from "@/components/marketing/pricing-content";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Ryloom pricing — start free with 25 videos, then pay per creator. Viewers are always free. Compare Starter, Pro, Business, Business + AI, and Enterprise.",
};

export default function PricingPage() {
  return <PricingContent />;
}
