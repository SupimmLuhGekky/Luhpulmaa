export const SESSION_COOKIE = "harbour_session";
export const SESSION_TTL_DAYS = 30;
/** Sessions are slid forward at most once per this interval to limit writes. */
export const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const MAX_FAILED_LOGINS = 8;
export const LOCKOUT_MS = 15 * 60 * 1000;
