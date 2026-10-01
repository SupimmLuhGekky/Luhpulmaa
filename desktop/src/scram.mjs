// @ts-check
import crypto from "node:crypto";

/**
 * Builds a PostgreSQL SCRAM-SHA-256 password verifier
 * ("SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>", RFC 5802/7677).
 * PostgreSQL stores a pre-computed verifier as-is, so plaintext database passwords
 * never have to be written to disk, passed to initdb, or sent in SQL.
 *
 * Passwords here are random base64url strings, for which SASLprep is the identity.
 * @param {string} password
 * @param {{ iterations?: number, salt?: Buffer }} [options]
 */
export function scramSha256Verifier(password, options = {}) {
  const iterations = options.iterations ?? 4096;
  const salt = options.salt ?? crypto.randomBytes(16);
  const salted = crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = crypto.createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const serverKey = crypto.createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
