import type { AccountDTO, listConnections, mockInstitutions } from "@/lib/accounts/service";

/** Plain, serialisable shapes the server pages hand to the account components. */
export type AccountView = AccountDTO;
export type ConnectionView = Awaited<ReturnType<typeof listConnections>>[number];
export type MockInstitution = ReturnType<typeof mockInstitutions>[number];

export interface BankingInfo {
  /** ENABLE_BANKING flag. */
  enabled: boolean;
  /** Default provider: MOCK (demo), PLAID or FLINKS. */
  provider: string;
  displayName: string;
  /** Credentials for the provider are present on the server. */
  configured: boolean;
  /** The provider only produces simulated data (demo mode). */
  simulated: boolean;
  /** People can connect their own Lunch Flow account (needs no server keys). */
  lunchFlow: boolean;
}

/** Ways to add an account on /accounts/new (`?method=`). */
export const ADD_METHODS = ["csv", "manual", "connect"] as const;
export type AddMethod = (typeof ADD_METHODS)[number];
