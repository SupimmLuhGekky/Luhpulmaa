import { Suspense } from "react";
import type { Metadata } from "next";
import { requireOnboardedUser } from "@/lib/auth/guard";
import { todayIn } from "@/lib/dates";
import { loadAccountCount, loadLayout } from "@/lib/dashboard/service";
import { userPreferences } from "@/lib/settings/preferences";
import { FormatProvider } from "@/components/providers/format-provider";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { CustomizeDashboard } from "@/components/dashboard/customize-dialog";
import { GetStarted } from "@/components/dashboard/get-started";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { WidgetSkeleton } from "@/components/dashboard/widget-card";
import { MOBILE_ORDER, TALL_WIDGETS, WIDGETS, WIDGET_SPAN } from "@/components/dashboard/widgets";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(timeZone: string, locale: string, firstName: string) {
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-CA", { hour: "numeric", hourCycle: "h23", timeZone }).format(now));
  const part = hour >= 5 && hour < 12 ? "Good morning" : hour >= 12 && hour < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone }).format(now);
  return { title: `${part}, ${firstName}`, date };
}

export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const today = todayIn(user.timeZone);
  const [{ layout, customized, personalized }, accountCount, prefs] = await Promise.all([loadLayout(user.id), loadAccountCount(user.id), userPreferences(user.id)]);
  const { title, date } = greeting(user.timeZone, user.locale, user.firstName);
  const visible = layout.widgets.filter((w) => w.visible);

  return (
    <FormatProvider value={{ currency: user.currency, locale: user.locale, timeZone: user.timeZone, today, roundOverview: prefs.roundOverviewAmounts }}>
      <PageHeader title={title} description={date} actions={<CustomizeDashboard layout={layout} customized={customized} />} />
      <QuickActions className="mb-5" />
      {accountCount === 0 ? (
        <div className="mb-5">
          <GetStarted />
        </div>
      ) : null}
      <div className="grid grid-flow-row-dense gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((w) => {
          const Widget = WIDGETS[w.id];
          return (
            // The plain default puts the everyday cards first on phones; an arranged or personalised order applies everywhere.
            <div key={w.id} className={cn("min-w-0", WIDGET_SPAN[w.id], !customized && !personalized && cn(MOBILE_ORDER[w.id] ?? "order-6", "md:order-none"))}>
              <Suspense fallback={<WidgetSkeleton className="h-full" tall={TALL_WIDGETS.has(w.id)} />}>
                <Widget userId={user.id} today={today} />
              </Suspense>
            </div>
          );
        })}
      </div>
    </FormatProvider>
  );
}
