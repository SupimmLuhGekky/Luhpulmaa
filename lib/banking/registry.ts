import "server-only";
import type { ProviderType } from "@prisma/client";
import { env } from "@/lib/config/env";
import { isEnabled } from "@/lib/flags";
import { FlinksProvider } from "./providers/flinks";
import { LunchFlowProvider } from "./providers/lunchflow";
import { MockProvider } from "./providers/mock";
import { PlaidProvider } from "./providers/plaid";
import { ProviderError, type FinancialDataProvider } from "./types";

/**
 * Chooses the financial-data provider.
 *  - development: MOCK unless BANKING_PROVIDER says otherwise
 *  - test: always MOCK (deterministic fixtures)
 *  - production: BANKING_PROVIDER (plaid | flinks). "mock" is allowed only for demo
 *    deployments and every mock account is clearly labelled as simulated.
 *
 * Lunch Flow sits beside the default provider rather than replacing it: anyone can
 * connect their own Lunch Flow account with its API key, whatever this server uses.
 */
const instances: Partial<Record<ProviderType, FinancialDataProvider>> = {};

export function getProvider(type: ProviderType): FinancialDataProvider {
  if (!instances[type]) {
    switch (type) {
      case "MOCK":
        instances.MOCK = new MockProvider();
        break;
      case "PLAID":
        instances.PLAID = new PlaidProvider();
        break;
      case "FLINKS":
        instances.FLINKS = new FlinksProvider();
        break;
      case "LUNCHFLOW":
        instances.LUNCHFLOW = new LunchFlowProvider();
        break;
      default:
        throw new ProviderError("INVALID_REQUEST", "This account is not connected through a data provider.");
    }
  }
  return instances[type]!;
}

export function defaultProviderType(): ProviderType {
  const e = env();
  if (e.appEnv === "test") return "MOCK";
  const configured = e.BANKING_PROVIDER ?? (e.appEnv === "production" ? "plaid" : "mock");
  return configured.toUpperCase() as ProviderType;
}

export function getDefaultProvider(): FinancialDataProvider {
  if (!isEnabled("ENABLE_BANKING")) throw new ProviderError("NOT_CONFIGURED", "Bank connections are turned off on this server.");
  return getProvider(defaultProviderType());
}

export function bankingStatus() {
  const enabled = isEnabled("ENABLE_BANKING");
  const type = defaultProviderType();
  const provider = getProvider(type);
  return { enabled, provider: type, displayName: provider.displayName, configured: provider.isConfigured(), simulated: provider.isSimulated };
}

/** Lunch Flow needs no server keys, so it is available whenever bank connections are on. */
export function lunchFlowAvailable(): boolean {
  return isEnabled("ENABLE_BANKING");
}
