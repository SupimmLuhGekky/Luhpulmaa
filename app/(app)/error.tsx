"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/shared/error-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Only the opaque digest is logged client-side; details stay in server logs.
    if (error.digest) console.error(`Page error (ref ${error.digest})`);
  }, [error]);
  return <ErrorState onRetry={reset} message={error.digest ? `We couldn't load this page. Your data is safe. (Reference: ${error.digest})` : undefined} />;
}
