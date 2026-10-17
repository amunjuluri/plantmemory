import { ViewTransition } from "react";

/** A template mounts afresh on every route change (a layout doesn't), so the old page
 * exits and the new one enters. The motion is in globals.css (page-exit, page-enter).
 * The div gives the transition one element that lasts: pages swap their loading shimmer
 * for content while it plays, and the browser cancels it if its element is removed. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
