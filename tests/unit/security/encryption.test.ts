import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A throwaway key per test run; never a real secret.
const state = vi.hoisted(() => ({ key: "" }));
vi.mock("@/lib/config/env", () => ({ env: () => ({ ENCRYPTION_KEY: state.key }) }));

const { decryptSecret, encryptSecret } = await import("@/lib/security/encryption");

const FAKE_TOKEN = "access-sandbox-00000000-fictional-token";

function parts(payload: string) {
  const [version, iv, tag, data] = payload.split(":");
  return { version, iv: Buffer.from(iv, "base64"), tag: Buffer.from(tag, "base64"), data: Buffer.from(data, "base64") };
}
const join = (p: ReturnType<typeof parts>) => [p.version, p.iv.toString("base64"), p.tag.toString("base64"), p.data.toString("base64")].join(":");

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    state.key = randomBytes(32).toString("base64");
  });

  it("round-trips secrets, including unicode and long values", () => {
    for (const secret of [FAKE_TOKEN, "mock:42:2026-10-01:mock_maple", "clé-secrète-éàç-🔑", "x".repeat(10_000)]) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it("round-trips an empty string", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("uses the v1 format with a fresh 96-bit IV and a 128-bit tag, so equal inputs encrypt differently", () => {
    const a = encryptSecret(FAKE_TOKEN);
    const b = encryptSecret(FAKE_TOKEN);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(parts(a).iv).toHaveLength(12);
    expect(parts(a).tag).toHaveLength(16);
    expect(a).not.toContain(FAKE_TOKEN);
    expect(Buffer.from(parts(a).data).toString("utf8")).not.toContain("fictional");
  });

  it("detects tampering with the ciphertext, IV or tag", () => {
    const p = parts(encryptSecret(FAKE_TOKEN));
    const flip = (buf: Buffer, i = 0) => {
      const copy = Buffer.from(buf);
      copy[i] ^= 0x01;
      return copy;
    };
    expect(() => decryptSecret(join({ ...p, data: flip(p.data) }))).toThrow();
    expect(() => decryptSecret(join({ ...p, data: flip(p.data, p.data.length - 1) }))).toThrow();
    expect(() => decryptSecret(join({ ...p, iv: flip(p.iv) }))).toThrow();
    expect(() => decryptSecret(join({ ...p, tag: flip(p.tag, 15) }))).toThrow();
  });

  it("rejects a truncated authentication tag", () => {
    const p = parts(encryptSecret(FAKE_TOKEN));
    for (const length of [4, 8, 12]) {
      expect(() => decryptSecret(join({ ...p, tag: p.tag.subarray(0, length) })), `${length}-byte tag`).toThrow();
    }
  });

  it("fails with the wrong key", () => {
    const payload = encryptSecret(FAKE_TOKEN);
    state.key = randomBytes(32).toString("base64");
    expect(() => decryptSecret(payload)).toThrow();
  });

  it("rejects malformed payloads and unknown versions", () => {
    const payload = encryptSecret(FAKE_TOKEN);
    expect(() => decryptSecret(payload.replace(/^v1:/, "v2:"))).toThrow("Unrecognised encrypted payload");
    expect(() => decryptSecret("not-encrypted")).toThrow("Unrecognised encrypted payload");
    expect(() => decryptSecret("v1:abc:def")).toThrow("Unrecognised encrypted payload");
    expect(() => decryptSecret(FAKE_TOKEN)).toThrow();
  });

  it("refuses a key that is not 32 bytes", () => {
    state.key = randomBytes(16).toString("base64");
    expect(() => encryptSecret(FAKE_TOKEN)).toThrow(/32 bytes/);
  });
});
