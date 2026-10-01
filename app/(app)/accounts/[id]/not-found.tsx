import Link from "next/link";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";

export default function AccountNotFound() {
  return (
    <Card>
      <EmptyState
        icon={Landmark}
        title="We couldn't find that account"
        description="It may have been deleted, or the link is wrong."
        action={
          <Button asChild>
            <Link href="/accounts">Back to accounts</Link>
          </Button>
        }
      />
    </Card>
  );
}
