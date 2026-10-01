/**
 * Client-safe helpers for the hosted Flinks Connect iframe (no secrets here).
 * The iframe reports progress with `window.postMessage`; the `REDIRECT` step
 * carries the `loginId` we hand to the server to finish the connection.
 */
export interface FlinksConnectResult {
  loginId: string;
  institution: string | null;
}

const LOGIN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a message event really comes from the Flinks Connect origin we opened. */
export function isFlinksOrigin(eventOrigin: string, connectUrl: string): boolean {
  try {
    return new URL(connectUrl).origin === eventOrigin;
  } catch {
    return false;
  }
}

/** Pulls the loginId out of a Flinks Connect `REDIRECT` message (or its redirect URL). */
export function parseFlinksMessage(data: unknown): FlinksConnectResult | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.step !== "REDIRECT") return null;
  let loginId = typeof d.loginId === "string" ? d.loginId : null;
  let institution = typeof d.institution === "string" ? d.institution : null;
  if (!loginId && typeof d.url === "string") {
    try {
      const u = new URL(d.url);
      loginId = u.searchParams.get("loginId");
      institution ??= u.searchParams.get("institution");
    } catch {
      return null;
    }
  }
  return loginId && LOGIN_ID.test(loginId) ? { loginId, institution } : null;
}
