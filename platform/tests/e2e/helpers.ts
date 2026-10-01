import { expect, type Page } from "@playwright/test";

export const SEED_PASSWORD = "delta-demo-password";

let n = 0;
export function uniqueEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${++n}@e2e.example`;
}

export async function register(page: Page, name: string, email: string, password = "e2e-password-123456") {
  await page.goto("/register");
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function login(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(o\/[^/]+|onboarding)$/);
}

export async function createOrg(page: Page, name: string, slug: string) {
  await page.getByLabel("Organization name").fill(name);
  await page.getByLabel("Address").fill(slug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

import type { Browser, BrowserContext } from "@playwright/test";

const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

/**
 * A browser context signed in as `email`. Sessions are cached per run so
 * suites don't trip the (real) per-account login rate limit.
 */
export async function sessionFor(browser: Browser, email: string, password = SEED_PASSWORD): Promise<BrowserContext> {
  const cached = sessions.get(email);
  if (cached) return browser.newContext({ storageState: cached });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email, password);
  sessions.set(email, await ctx.storageState());
  await page.close();
  return ctx;
}
