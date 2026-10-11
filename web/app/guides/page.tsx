import type { Metadata } from "next";

import { GuidesList } from "@/components/guide/guides-list";

export const metadata: Metadata = { title: "Repair guides" };

export default function GuidesPage() {
  return <GuidesList />;
}
