import type { Metadata } from "next";

import { LogbookView } from "@/components/logbook/logbook-view";

export const metadata: Metadata = { title: "Digitize logbook" };

export default function LogbookPage() {
  return <LogbookView />;
}
