"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, NotebookPen } from "lucide-react";
import { CONTRIBUTION_KIND_OPTIONS } from "@/lib/settings/options";
import { updatePreferencesAction } from "@/app/actions/settings";
import { RadioCards } from "./radio-cards";

type Kind = (typeof CONTRIBUTION_KIND_OPTIONS)[number]["value"];

const ICONS: Record<Kind, React.ReactNode> = {
  PLANNED_ALLOCATION: <NotebookPen className="size-4" />,
  USER_REPORTED_TRANSFER: <ArrowRightLeft className="size-4" />,
};

/** Default for "Add money to a goal": saved as soon as it changes. */
export function GoalContributionKindForm({ initial }: { initial: Kind }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<Kind>(initial);
  const [saving, setSaving] = React.useState(false);

  const change = async (next: Kind) => {
    if (next === kind || saving) return;
    const previous = kind;
    setKind(next);
    setSaving(true);
    const res = await updatePreferencesAction({ goalContributionKind: next });
    setSaving(false);
    if (!res.ok) {
      setKind(previous);
      toast.error("Couldn't save that", { description: res.error.message });
      return;
    }
    toast.success("Default saved", { description: `New contributions start as “${CONTRIBUTION_KIND_OPTIONS.find((o) => o.value === next)?.label}”.` });
    router.refresh();
  };

  return (
    <RadioCards
      aria-labelledby="contribution-kind-title"
      value={kind}
      onChange={change}
      columns={2}
      options={CONTRIBUTION_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label, description: o.description, icon: ICONS[o.value] }))}
    />
  );
}
