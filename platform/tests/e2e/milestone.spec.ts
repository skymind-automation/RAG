import { expect, test } from "@playwright/test";
import { createOrg, login, logout, register, uniqueEmail } from "./helpers";

/**
 * First-milestone flows, end to end against the production build:
 * register → create org → second org → switch → invite → accept →
 * role-based denial → removal revokes access.
 */

test("anonymous users are sent to login", async ({ page }) => {
  await page.goto("/o/delta-ops");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fo%2Fdelta-ops/);
});

test("register, create two organizations and switch between them", async ({ page }) => {
  const email = uniqueEmail("founder");
  await register(page, "Fran Founder", email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText("Welcome, Fran")).toBeVisible();

  const slugA = `alpha-${Date.now()}`;
  await createOrg(page, "Alpha Ops", slugA);
  await expect(page.getByTestId("org-switcher")).toContainText("Owner");

  await page.getByTestId("org-switcher").click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const slugB = `bravo-${Date.now()}`;
  await createOrg(page, "Bravo Support", slugB);

  await page.getByTestId("org-switcher").click();
  await page.getByRole("menuitem", { name: /Alpha Ops/ }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slugA}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Alpha Ops" })).toBeVisible();

  // The switch is remembered as the landing organization.
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/o/${slugA}$`));

  // Audit trail recorded the switch.
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("organization.switched").first()).toBeVisible();
});

test("invite a member, accept, and enforce their role", async ({ browser, page }) => {
  const ownerEmail = uniqueEmail("owner");
  await register(page, "Olivia Owner", ownerEmail);
  const slug = `invite-${Date.now()}`;
  await createOrg(page, "Invite Co", slug);

  const agentEmail = uniqueEmail("agent");
  await page.goto(`/o/${slug}/members`);
  await page.getByRole("button", { name: "Invite member" }).click();
  await page.getByLabel("Email").fill(agentEmail);
  await page.getByRole("button", { name: "Create invitation" }).click();
  const inviteUrl = await page.getByTestId("invite-url").inputValue();
  expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Pending invitations")).toBeVisible();

  // Invitee, in a separate browser context.
  const ctx = await browser.newContext();
  const invitee = await ctx.newPage();
  await invitee.goto(new URL(inviteUrl).pathname);
  await expect(invitee.getByText("Join Invite Co")).toBeVisible();
  await invitee.getByRole("link", { name: "Create account" }).click();
  await invitee.getByLabel("Full name").fill("Andy Agent");
  await invitee.getByLabel("Work email").fill(agentEmail);
  await invitee.getByLabel("Password").fill("agent-password-123456");
  await invitee.getByRole("button", { name: "Create account" }).click();
  await expect(invitee).toHaveURL(/\/invite\//);
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await expect(invitee).toHaveURL(new RegExp(`/o/${slug}$`));
  await expect(invitee.getByTestId("org-switcher")).toContainText("Agent");

  // Agents cannot see organization administration.
  await expect(invitee.getByRole("link", { name: "Settings" })).toHaveCount(0);
  const denied = await invitee.goto(`/o/${slug}/settings`);
  expect(denied?.status()).toBe(404);
  await invitee.goto(`/o/${slug}/members`);
  await expect(invitee.getByRole("button", { name: "Invite member" })).toHaveCount(0);

  // Owner removes the agent; access ends on the agent's next request.
  await page.reload();
  const row = page.getByTestId(`member-${agentEmail}`);
  await row.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
  const gone = await invitee.goto(`/o/${slug}`);
  expect(gone?.status()).toBe(404);
  await ctx.close();
});

test("seeded tenants are isolated from each other", async ({ page }) => {
  await login(page, "maya.chen@delta.example");
  await expect(page).toHaveURL(/\/o\/delta-ops$/);
  await page.getByRole("link", { name: "Tickets" }).first().click();
  await expect(page.getByTestId("ticket-row")).toHaveCount(18);
  await expect(page.getByText(/NWH-\d+/)).toHaveCount(0);
  await expect(page.getByText("remote radiologists")).toHaveCount(0);

  // Not a member of Northwind: indistinguishable from a missing org.
  const res = await page.goto("/o/northwind");
  expect(res?.status()).toBe(404);
  const api = await page.request.get("/api/orgs/northwind/tickets");
  expect(api.status()).toBe(404);
  const own = await page.request.get("/api/orgs/delta-ops/tickets?limit=5");
  expect(own.status()).toBe(200);
  const body = (await own.json()) as { data: { items: { key: string }[] } };
  expect(body.data.items.every((t) => t.key.startsWith("IT-"))).toBe(true);
  await page.goto("/o/delta-ops");
  await logout(page);
});

test("a multi-organization user holds different roles per organization", async ({ page }) => {
  await login(page, "luis.ortega@delta.example");
  await page.goto("/o/northwind");
  await expect(page.getByTestId("org-switcher")).toContainText("Viewer");
  // Viewers never see internal-only administration.
  expect((await page.goto("/o/northwind/audit"))?.status()).toBe(404);
  await page.goto("/o/delta-ops");
  await expect(page.getByTestId("org-switcher")).toContainText("Agent");
});

test("requesters only see their own tickets", async ({ page }) => {
  await login(page, "ben.carter@northwind.example");
  await page.goto("/o/northwind/tickets");
  await expect(page.getByRole("heading", { name: "My requests" })).toBeVisible();
  const rows = page.getByTestId("ticket-row");
  expect(await rows.count()).toBeGreaterThan(0);
  for (const text of await rows.allInnerTexts()) expect(text).toContain("Ben Carter");
  expect((await page.goto("/o/northwind/members"))?.status()).toBe(404);
});

test("wrong password shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("maya.chen@delta.example");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Invalid email or password." })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
