import type { Metadata } from "next";
import { Suspense } from "react";

import { AddView } from "@/components/add/add-view";

export const metadata: Metadata = { title: "Add records" };

export default function AddPage() {
  return (
    <Suspense>
      <AddView />
    </Suspense>
  );
}
