import type { Metadata } from "next";
import { Suspense } from "react";

import { PrintView } from "@/components/guide/print-sheet";

export const metadata: Metadata = { title: "Print repair guide" };

export default function PrintPage() {
  return (
    <Suspense>
      <PrintView />
    </Suspense>
  );
}
