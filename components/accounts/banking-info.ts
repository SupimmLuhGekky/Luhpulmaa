import "server-only";
import { bankingStatus } from "@/lib/banking/registry";
import type { BankingInfo } from "./types";

/** Banking provider status for the client, treating a misconfigured provider as unavailable. */
export function bankingInfo(): BankingInfo {
  try {
    const s = bankingStatus();
    return { enabled: s.enabled, provider: s.provider, displayName: s.displayName, configured: s.configured, simulated: s.simulated };
  } catch {
    return { enabled: false, provider: "NONE", displayName: "Bank connections", configured: false, simulated: false };
  }
}
