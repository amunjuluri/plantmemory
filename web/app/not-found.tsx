import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <p className="font-mono text-sm text-fg-subtle">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn’t exist</h1>
      <Link href="/" className={buttonVariants({ variant: "primary" })}>
        Back to Analyze
      </Link>
    </div>
  );
}
