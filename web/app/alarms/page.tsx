import type { Metadata } from "next";

import { AlarmsView } from "@/components/alarms/alarms-view";

export const metadata: Metadata = { title: "Alarm logs" };

export default function AlarmsPage() {
  return <AlarmsView />;
}
