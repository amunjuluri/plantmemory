import type { Metadata } from "next";
import { Suspense } from "react";

import { GuidePage } from "@/components/guide/guide-page";

export const metadata: Metadata = { title: "Repair guide" };

export default function GuideViewPage() {
  return (
    <Suspense>
      <GuidePage />
    </Suspense>
  );
}
