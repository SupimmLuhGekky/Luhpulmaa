import {
  ArrowLeftRight, Baby, Book, Briefcase, Bus, Car, Circle, CircleDashed, Clapperboard, Coffee, Dog, Dumbbell, Fuel, Gamepad2, Gift,
  GraduationCap, HeartPulse, House, Landmark, Music, PiggyBank, Plane, Receipt, Repeat, Shield, Shirt, ShoppingBag, ShoppingBasket,
  Smartphone, Sparkles, User, Utensils, Wallet, Wifi, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Static map (keeps the icon bundle small) from stored icon names to Lucide components. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  home: House, zap: Zap, "shopping-basket": ShoppingBasket, utensils: Utensils, coffee: Coffee, bus: Bus, car: Car, fuel: Fuel,
  "shopping-bag": ShoppingBag, clapperboard: Clapperboard, repeat: Repeat, "heart-pulse": HeartPulse, shield: Shield,
  "graduation-cap": GraduationCap, plane: Plane, user: User, receipt: Receipt, "circle-dashed": CircleDashed, wallet: Wallet,
  "arrow-left-right": ArrowLeftRight, gift: Gift, baby: Baby, dog: Dog, dumbbell: Dumbbell, music: Music, "gamepad-2": Gamepad2,
  book: Book, briefcase: Briefcase, smartphone: Smartphone, wifi: Wifi, "piggy-bank": PiggyBank, landmark: Landmark,
  sparkles: Sparkles, shirt: Shirt, wrench: Wrench, circle: Circle,
};

export function iconFor(name: string | null | undefined): LucideIcon {
  return (name && CATEGORY_ICONS[name]) || CircleDashed;
}

/** Coloured rounded square with the category's icon. */
export function CategoryIcon({ icon, color, size = "md", className }: { icon?: string | null; color?: string | null; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = iconFor(icon);
  const c = color ?? "#94a3b8";
  const dims = size === "sm" ? "size-6 rounded-md [&_svg]:size-3.5" : size === "lg" ? "size-10 rounded-xl [&_svg]:size-5" : "size-8 rounded-lg [&_svg]:size-4";
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center", dims, className)} style={{ backgroundColor: `${c}1f`, color: c }} aria-hidden>
      <Icon />
    </span>
  );
}
