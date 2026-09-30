import "server-only";
import type { ProviderType } from "@prisma/client";
import { env } from "@/lib/config/env";
import { isEnabled } from "@/lib/flags";
import { FlinksProvider } from "./providers/flinks";
import { MockProvider } from "./providers/mock";
import { PlaidProvider } from "./providers/plaid";
import { ProviderError, type FinancialDataProvider } from "./types";

/**
 * Chooses the financial-data provider.
 *  - development: MOCK unless BANKING_PROVIDER says otherwise
 *  - test: always MOCK (deterministic fixtures)
 *  - production: BANKING_PROVIDER (plaid | flinks). "mock" is allowed only for demo
 *    deployments and every mock account is clearly labelled as simulated.
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
