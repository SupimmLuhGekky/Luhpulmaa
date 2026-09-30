import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges conditional class names and resolves Tailwind conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Initials for avatars ("Supimm Luh" → "SL"). */
export function initials(first: string, last?: string | null) {
  return `${first.trim()[0] ?? ""}${last?.trim()[0] ?? ""}`.toUpperCase() || "?";
}
