import { describe, expect, it } from "vitest";
import { redact } from "@/lib/security/redact";
import { generateToken, hashToken, safeEqual } from "@/lib/security/tokens";

describe("generateToken", () => {
  it("returns 256-bit URL-safe tokens by default", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });
});

describe("hashToken", () => {
  it("is SHA-256 hex", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashToken("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("is deterministic and does not contain the token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).not.toBe(hashToken(`${token}x`));
  });
});

describe("safeEqual", () => {
  it("compares strings without throwing on different lengths", () => {
    expect(safeEqual("secret-value", "secret-value")).toBe(true);
    expect(safeEqual("secret-value", "secret-valuf")).toBe(false);
    expect(safeEqual("short", "much-longer-value")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("é", "e")).toBe(false);
  });
});

describe("redact", () => {
  const FAKE = {
    password: "hunter2-fictional",
    token: "tok_fictional",
    accessToken: "access-sandbox-fictional",
    refresh_token: "refresh-fictional",
    Authorization: "Bearer fictional",
    cookie: "harbour_session=fictional",
    apiKey: "key-fictional",
    "x-api-key": "key-fictional-2",
    clientSecret: "secret-fictional",
    accountNumber: "000123456789",
    account_number: "000987654321",
    cardNumber: "4111111111111111",
    cvv: "123",
    sin: "046 454 286",
    pin: "1234",
  };
  const secrets = Object.values(FAKE);

  const leaks = (value: unknown) => {
    const json = JSON.stringify(value);
    return secrets.filter((s) => json.includes(s));
  };

  it("redacts sensitive keys and keeps everything else", () => {
    const out = redact({ ...FAKE, email: "alex@example.com", amountCents: 1234, institution: "Fictional Credit Union" });
    for (const key of Object.keys(FAKE)) expect(out[key as keyof typeof FAKE], key).toBe("[REDACTED]");
    expect(out).toMatchObject({ email: "alex@example.com", amountCents: 1234, institution: "Fictional Credit Union" });
  });

  it("redacts PINs, SINs and card codes under any spelling, but not words that contain them", () => {
    const out = redact({ userPin: "1", PINCode: "2", pin_code: "3", sinNumber: "4", card_cvv: "5", SSN: "6", cvc: "7", businessName: "Fictional Inc", shippingAddress: "1 Fictional St", processingTime: 3, opinion: "fine", missing: false });
    for (const key of ["userPin", "PINCode", "pin_code", "sinNumber", "card_cvv", "SSN", "cvc"]) expect(out[key as keyof typeof out], key).toBe("[REDACTED]");
    expect(out).toMatchObject({ businessName: "Fictional Inc", shippingAddress: "1 Fictional St", processingTime: 3, opinion: "fine", missing: false });
  });

  it("redacts nested objects and arrays", () => {
    const out = redact({ user: { id: "u1", credentials: { a: 1 } }, connections: [{ id: "c1", accessToken: FAKE.accessToken }, { id: "c2", items: [{ password: FAKE.password }] }] });
    expect(leaks(out)).toEqual([]);
    expect(out.user.credentials).toBe("[REDACTED]");
    expect(out.connections[0]).toEqual({ id: "c1", accessToken: "[REDACTED]" });
  });

  it("never leaks secrets however deeply they are nested", () => {
    let deep: Record<string, unknown> = { password: FAKE.password, accountNumber: FAKE.accountNumber };
    for (let i = 0; i < 12; i++) deep = { level: deep };
    expect(leaks(redact(deep))).toEqual([]);
    let deepArray: unknown = [{ token: FAKE.token }];
    for (let i = 0; i < 12; i++) deepArray = [deepArray];
    expect(leaks(redact(deepArray))).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = { password: FAKE.password, nested: { token: FAKE.token } };
    redact(input);
    expect(input).toEqual({ password: FAKE.password, nested: { token: FAKE.token } });
  });

  it("serialises BigInts and keeps dates and primitives", () => {
    const when = new Date("2026-10-01T12:00:00Z");
    expect(redact({ amountCents: 123n, at: when, ok: true, n: null })).toEqual({ amountCents: "123", at: when, ok: true, n: null });
    expect(redact("plain")).toBe("plain");
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});
