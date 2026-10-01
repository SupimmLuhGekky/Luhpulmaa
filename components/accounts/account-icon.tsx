import type { AccountType } from "@prisma/client";
import { Banknote, CreditCard, Gem, HandCoins, House, Landmark, PiggyBank, Receipt, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const ACCOUNT_TYPE_ICONS: Record<AccountType, LucideIcon> = {
  CHEQUING: Landmark,
  SAVINGS: PiggyBank,
  CASH: Wallet,
  CREDIT_CARD: CreditCard,
  LINE_OF_CREDIT: HandCoins,
  LOAN: Receipt,
  MORTGAGE: House,
  INVESTMENT: TrendingUp,
  OTHER_ASSET: Gem,
  OTHER_LIABILITY: Banknote,
};

const HEX = /^#[0-9a-f]{6}$/i;
const sizes = { sm: "size-7 rounded-md [&_svg]:size-3.5", md: "size-9 rounded-lg [&_svg]:size-[18px]", lg: "size-11 rounded-xl [&_svg]:size-5" } as const;

/** Tinted square with an icon, in the institution's brand colour when it has one. */
export function TintedIcon({ icon: Icon, color, size = "md", className }: { icon: LucideIcon; color?: string | null; size?: keyof typeof sizes; className?: string }) {
  const tint = color && HEX.test(color) ? color : null;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", sizes[size], !tint && "bg-primary-soft text-primary", className)}
      style={tint ? { backgroundColor: `${tint}1f`, color: tint } : undefined}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

export function AccountIcon({ type, color, size, className }: { type: AccountType; color?: string | null; size?: keyof typeof sizes; className?: string }) {
  return <TintedIcon icon={ACCOUNT_TYPE_ICONS[type] ?? Landmark} color={color} size={size} className={className} />;
}

export function InstitutionIcon({ color, size, className }: { color?: string | null; size?: keyof typeof sizes; className?: string }) {
  return <TintedIcon icon={Landmark} color={color} size={size} className={className} />;
}
