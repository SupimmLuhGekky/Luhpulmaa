import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/config/env";

/**
 * AES-256-GCM encryption for secrets at rest (financial-provider access tokens).
 * Format: "v1:<iv b64>:<auth tag b64>:<ciphertext b64>".
 * The key comes from ENCRYPTION_KEY (base64, 32 bytes) and never leaves the server.
 */
const VERSION = "v1";

function key(): Buffer {
  const raw = Buffer.from(env().ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)");
  return raw;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  // An empty secret encrypts to empty ciphertext, so only a missing part is malformed.
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) throw new Error("Unrecognised encrypted payload");
  // Pin the tag length: without it, GCM accepts truncated (4–12 byte) tags, weakening authentication.
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
