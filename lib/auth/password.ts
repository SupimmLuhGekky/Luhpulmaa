import "server-only";
import bcrypt from "bcryptjs";
export { passwordSchema } from "./schemas";

const COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

let dummyHash: Promise<string> | null = null;

/** Burns the same bcrypt time as a real check, so response time never reveals whether an email exists. */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  dummyHash ??= bcrypt.hash("harbour-timing-equaliser", COST);
  await bcrypt.compare(plain, await dummyHash);
  return false;
}
