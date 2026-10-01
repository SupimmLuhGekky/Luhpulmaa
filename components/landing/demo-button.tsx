"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { demoSignInAction } from "@/app/actions/auth";

/** Opens the shared demo account (simulated bank data, nothing real). */
export function DemoButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Button
      variant="outline"
      size="lg"
      className={className}
      loading={pending}
      onClick={() =>
        start(async () => {
          const res = await demoSignInAction({});
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          router.replace("/dashboard");
          router.refresh();
        })
      }
    >
      <Sparkles /> Try the demo
    </Button>
  );
}
