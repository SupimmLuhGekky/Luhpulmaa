import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";

export default function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="We couldn't find that"
      description="It may have been deleted, or the link is wrong."
      action={
        <Button asChild>
          <Link href="/dashboard">Back to the dashboard</Link>
        </Button>
      }
    />
  );
}
