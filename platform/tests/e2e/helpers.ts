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
