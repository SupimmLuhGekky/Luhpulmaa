/**
 * Interfaces reserved for a future, separately licensed banking core. The budgeting
 * app never implements these: it organises information about money held at other
 * institutions and cannot hold deposits, issue cards or move funds.
 *
 * Any real implementation must live behind regulatory approval (e.g. a partner bank
 * or payments licence), post every movement to the double-entry ledger
 * (lib/ledger) with an idempotency key, and pass KYC/AML checks. Until then every
 * method throws BankingCoreUnavailableError so no code path can pretend money moved.
 */
import type { LedgerService } from "@/lib/ledger/types";

export const COMPLIANCE_NOTICE =
  "This application provides financial organization and budgeting tools. It is not a bank and does not itself hold customer deposits.";

export class BankingCoreUnavailableError extends Error {
  readonly code = "BANKING_CORE_UNAVAILABLE";
  constructor(operation: string) {
    super(`${operation} is not available. ${COMPLIANCE_NOTICE}`);
    this.name = "BankingCoreUnavailableError";
  }
}

export interface MoneyAmount {
  amountCents: number;
  currency: string;
}

export interface MovementRequest extends MoneyAmount {
  userId: string;
  idempotencyKey: string;
  fromAccountId: string;
  toAccountId: string;
  memo?: string;
}

export type MovementStatus = "PENDING" | "SETTLED" | "FAILED" | "RETURNED";

export interface MovementReceipt {
  id: string;
  status: MovementStatus;
  ledgerJournalEntryId: string;
}

export interface MoneyMovementService {
  initiateTransfer(request: MovementRequest): Promise<MovementReceipt>;
  getTransferStatus(id: string): Promise<MovementStatus>;
  cancelTransfer(id: string): Promise<void>;
}

export interface DepositService {
  openDepositAccount(userId: string, product: "CHEQUING" | "SAVINGS", currency: string): Promise<{ accountId: string }>;
  recordIncomingDeposit(accountId: string, amount: MoneyAmount, idempotencyKey: string): Promise<MovementReceipt>;
}

export interface WithdrawalService {
  requestWithdrawal(accountId: string, amount: MoneyAmount, idempotencyKey: string): Promise<MovementReceipt>;
}

export interface CardService {
  issueCard(userId: string, accountId: string): Promise<{ cardId: string; last4: string }>;
  freezeCard(cardId: string): Promise<void>;
  unfreezeCard(cardId: string): Promise<void>;
}

export interface BankingCore {
  readonly available: boolean;
  ledger: LedgerService | null;
  movements: MoneyMovementService;
  deposits: DepositService;
  withdrawals: WithdrawalService;
  cards: CardService;
}

const unavailable = (operation: string) => () => Promise.reject(new BankingCoreUnavailableError(operation));

/** The only BankingCore this app ships: every operation refuses. */
export const unavailableBankingCore: BankingCore = {
  available: false,
  ledger: null,
  movements: {
    initiateTransfer: unavailable("Transfers"),
    getTransferStatus: unavailable("Transfers"),
    cancelTransfer: unavailable("Transfers"),
  },
  deposits: {
    openDepositAccount: unavailable("Deposit accounts"),
    recordIncomingDeposit: unavailable("Deposits"),
  },
  withdrawals: { requestWithdrawal: unavailable("Withdrawals") },
  cards: {
    issueCard: unavailable("Cards"),
    freezeCard: unavailable("Cards"),
    unfreezeCard: unavailable("Cards"),
  },
};

export function bankingCore(): BankingCore {
  return unavailableBankingCore;
}
