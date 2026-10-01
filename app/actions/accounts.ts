"use server";

import { z } from "zod";
import { authedAction } from "@/lib/api/action";
import {
  completeConnection,
  createLinkSession,
  createManualAccount,
  deleteManualAccount,
  disconnectConnection,
  reconnectSimulatedConnection,
  syncAccount,
  syncConnectionNow,
  updateAccount,
} from "@/lib/accounts/service";
import { accountUpdateSchema, connectionIdSchema, connectSchema, disconnectSchema, linkSessionSchema, manualAccountSchema, syncAccountSchema } from "@/lib/accounts/schemas";
import { withProviderErrors } from "@/lib/accounts/errors";
import { enforceSyncLimit } from "@/lib/accounts/limits";
import { revalidateAccountViews } from "@/lib/accounts/revalidate";

const id = z.string().uuid();

export const createManualAccountAction = authedAction(manualAccountSchema, async (input, user) => {
  const account = await createManualAccount(user.id, input);
  revalidateAccountViews();
  return { id: account.id };
});

export const updateAccountAction = authedAction(z.object({ id, patch: accountUpdateSchema }), async ({ id: accountId, patch }, user) => {
  await updateAccount(user.id, accountId, patch);
  revalidateAccountViews();
  return { id: accountId };
});

/** Deletes a manual account together with all of its transactions. */
export const deleteManualAccountAction = authedAction(z.object({ id }), async ({ id: accountId }, user) => {
  await deleteManualAccount(user.id, accountId);
  revalidateAccountViews();
  return { deleted: true };
});

/** Starts the provider's hosted sign-in (Plaid Link, Flinks Connect). Optionally re-links an existing connection. */
export const createLinkSessionAction = authedAction(linkSessionSchema, async ({ reconnectConnectionId }, user) => {
  await enforceSyncLimit("link", user.id);
  return withProviderErrors(() => createLinkSession(user.id, reconnectConnectionId));
});

/** Exchanges the widget's one-time token and runs the first import. */
export const completeConnectionAction = authedAction(connectSchema, async ({ publicToken, metadata }, user) => {
  await enforceSyncLimit("sync", user.id);
  const result = await withProviderErrors(() => completeConnection(user.id, publicToken, metadata));
  revalidateAccountViews();
  return result;
});

/** Demo banks: re-link a simulated connection (there is no bank sign-in to repeat). */
export const reconnectSimulatedAction = authedAction(connectionIdSchema, async ({ connectionId }, user) => {
  await enforceSyncLimit("sync", user.id);
  const result = await withProviderErrors(() => reconnectSimulatedConnection(user.id, connectionId));
  revalidateAccountViews();
  return result;
});

export const syncAccountAction = authedAction(syncAccountSchema, async ({ accountId }, user) => {
  await enforceSyncLimit("sync", user.id);
  const outcome = await withProviderErrors(() => syncAccount(user.id, accountId));
  revalidateAccountViews();
  return outcome;
});

export const syncConnectionAction = authedAction(connectionIdSchema, async ({ connectionId }, user) => {
  await enforceSyncLimit("sync", user.id);
  const outcome = await withProviderErrors(() => syncConnectionNow(user.id, connectionId));
  revalidateAccountViews();
  return outcome;
});

/** Stops syncing and revokes the provider token. Imported history is kept unless `deleteData`. */
export const disconnectConnectionAction = authedAction(disconnectSchema, async ({ connectionId, deleteData }, user) => {
  await disconnectConnection(user.id, connectionId, deleteData);
  revalidateAccountViews();
  return { disconnected: true, deleted: deleteData };
});
