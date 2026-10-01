import { requireOnboardedUser } from "@/lib/auth/guard";
import { todayIn } from "@/lib/dates";
import { flags } from "@/lib/flags";
import { unreadCount } from "@/lib/notifications/service";
import { FormatProvider } from "@/components/providers/format-provider";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ShellProvider } from "@/components/layout/shell-provider";
import { Sidebar, type ShellFlags } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

/** Authenticated app shell: navigation, header, quick add and search around every page. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOnboardedUser();
  const f = flags();
  const shellFlags: ShellFlags = { assistant: f.ENABLE_AI_ASSISTANT, automations: f.ENABLE_AUTOMATIONS };
  const unread = await unreadCount(user.id);
  return (
    <FormatProvider value={{ currency: user.currency, locale: user.locale, timeZone: user.timeZone, today: todayIn(user.timeZone) }}>
      <ShellProvider flags={shellFlags}>
        <Sidebar flags={shellFlags} />
        <div className="flex min-h-dvh flex-col md:pl-16 xl:pl-60">
          <TopBar user={{ firstName: user.firstName, lastName: user.lastName, email: user.email, isDemo: user.isDemo }} unread={unread} />
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-12 lg:px-8">
            {children}
          </main>
        </div>
        <BottomNav flags={shellFlags} />
      </ShellProvider>
    </FormatProvider>
  );
}
