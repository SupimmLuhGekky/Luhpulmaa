"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { completeOnboardingAction } from "@/app/actions/onboarding";

/** "Skip setup": finishes onboarding now and opens the dashboard. */
export function SkipSetupButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Skip setup
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Skip the rest of setup?"
        description="You'll go straight to your dashboard. Anything you've saved so far stays, and you can add income, accounts, a budget and goals at any time."
        confirmLabel="Skip setup"
        onConfirm={async () => {
          const res = await completeOnboardingAction({ skipped: true });
          if (!res.ok) {
            toast.error(res.error.message);
            return;
          }
          // A full load: every page in the app now opens without coming back here.
          window.location.assign("/dashboard");
          await new Promise(() => {});
        }}
      />
    </>
  );
}
