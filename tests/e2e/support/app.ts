import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { e2eDatabaseUrl } from "./env";

/** The seeded demo account (documented in the README; all of its data is simulated). */
export const DEMO = { email: "demo@example.com", password: "harbour-demo-2026", firstName: "Alex" } as const;

/**
 * Opens a page and waits for the network to settle, so React has hydrated before the
 * test types into a form (react-hook-form resets fields filled before hydration).
 */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export interface FictionalUser {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

/** A made-up person with a unique address on the reserved example.com domain. */
export function fictionalUser(): FictionalUser {
  const id = randomUUID().slice(0, 8);
  return { firstName: "Robin", lastName: "Fictive", email: `e2e-${id}@example.com`, password: `fictional-${id}-pass1` };
}

/** Signs up through the form; new accounts land on /onboarding. */
export async function signUp(page: Page, user: FictionalUser = fictionalUser()): Promise<FictionalUser> {
  await open(page, "/sign-up");
  await page.getByLabel("First name", { exact: true }).fill(user.firstName);
  await page.getByLabel("Last name", { exact: true }).fill(user.lastName);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  return user;
}

/**
 * Marks onboarding finished in the database, so tests about other screens skip the nine
 * setup steps (the app only checks `onboardingCompletedAt`). onboarding.spec.ts walks
 * through the steps themselves.
 */
export async function finishOnboarding(email: string): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: e2eDatabaseUrl() });
  try {
    await prisma.user.update({ where: { email }, data: { onboardingCompletedAt: new Date() } });
  } finally {
    await prisma.$disconnect();
  }
}

/** A new fictional user, signed in on `page`, with onboarding done and no data yet. */
export async function newUser(page: Page): Promise<FictionalUser> {
  const user = await signUp(page);
  await finishOnboarding(user.email);
  return user;
}

export async function signInAsDemo(page: Page): Promise<void> {
  await open(page, "/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(DEMO.email);
  await page.getByLabel("Password", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/** A summary figure (a `<p>` label above its value), e.g. stat(page, "Planned income"). */
export function stat(scope: Page | Locator, label: string): Locator {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return scope.locator("p").filter({ hasText: exact }).locator("xpath=..");
}

/** Today's month in the owner's time zone, as YYYY-MM. */
export function currentMonth(timeZone = "America/Toronto"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}`;
}
