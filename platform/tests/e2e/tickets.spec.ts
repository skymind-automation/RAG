import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { sessionFor } from "./helpers";

/**
 * Phase 2 end to end: an agent works a ticket through its life; a requester
 * uses the portal; internal content never reaches the requester; files move
 * through presigned URLs; links and configuration work.
 */

const AGENT = "luis.ortega@delta.example";
const REQUESTER = "tom.walsh@delta.example";
const ADMIN = "omar.haddad@delta.example";
const BASE = "/o/delta-ops";

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}`;
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function createTicketAsAgent(page: Page, title: string, opts: { requester?: string } = {}) {
  await page.goto(`${BASE}/tickets/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Steps:\n\n1. Open the app\n2. **Boom**");
  if (opts.requester) await chooseOption(page, "Requester", opts.requester);
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/IT-\d{6}$/);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.url().split("/").pop()!;
}

test("agent creates, triages, works and resolves a ticket", async ({ browser }) => {
  const ctx = await sessionFor(browser, AGENT);
  const page = await ctx.newPage();
  const title = unique("Laptop dock not detected");
  await createTicketAsAgent(page, title);
  await expect(page.locator("strong", { hasText: "Boom" })).toBeVisible(); // Markdown rendered

  await chooseOption(page, "Priority", "High");
  await expect(
    page.getByTestId("timeline-event").filter({ hasText: "changed priority from Medium to High" }),
  ).toBeVisible();
  await chooseOption(page, "Assignee", "Luis Ortega");
  await expect(
    page.getByTestId("timeline-event").filter({ hasText: "assigned the ticket to Luis Ortega" }),
  ).toBeVisible();

  for (const status of ["Open", "In Progress"]) {
    await page.getByTestId("status-menu").click();
    await page.getByRole("menuitem", { name: status }).click();
    await expect(page.getByTestId("status-menu")).toContainText(status);
  }
  // Resolving requires a resolution.
  await page.getByTestId("status-menu").click();
  await page.getByRole("menuitem", { name: "Resolved" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Move to Resolved" }).click();
  await expect(dialog.getByText("A resolution is required.")).toBeVisible();
  await dialog.getByLabel("Resolution").fill("Updated the dock firmware to 1.4.2.");
  await dialog.getByRole("button", { name: "Move to Resolved" }).click();
  await expect(page.getByTestId("status-menu")).toContainText("Resolved");
  await expect(page.getByRole("region", { name: "Resolution" })).toContainText("dock firmware");
  await ctx.close();
});

test("internal notes and internal files never reach the requester", async ({ browser }) => {
  const agent = await (await sessionFor(browser, AGENT)).newPage();
  const title = unique("Email signature broken");
  const key = await createTicketAsAgent(agent, title, { requester: "Tom Walsh" });

  await agent.getByRole("textbox", { name: "Reply" }).fill("Could you send a screenshot?");
  await agent.getByRole("button", { name: "Send reply" }).click();
  await expect(agent.getByTestId("timeline-comment").filter({ hasText: "Could you send a screenshot?" })).toBeVisible();

  await agent.getByRole("tab", { name: "Internal note" }).click();
  await agent
    .locator("#comment-files")
    .setInputFiles({ name: "vendor-case.txt", mimeType: "text/plain", buffer: Buffer.from("case 4471") });
  await expect(agent.getByRole("listitem").filter({ hasText: "vendor-case.txt" })).toBeVisible();
  await agent.getByRole("textbox", { name: "Internal note" }).fill("Known Exchange bug, vendor case attached");
  await agent.getByRole("button", { name: "Add note" }).click();
  const note = agent.getByTestId("timeline-comment").filter({ hasText: "Known Exchange bug" });
  await expect(note).toHaveAttribute("data-visibility", "INTERNAL");
  await expect(note.getByRole("button", { name: /vendor-case\.txt/ })).toBeVisible();

  const portal = await (await sessionFor(browser, REQUESTER)).newPage();
  await portal.goto(`${BASE}/tickets/${key}`);
  await expect(portal.getByText("Could you send a screenshot?")).toBeVisible();
  await expect(portal.getByText("Known Exchange bug")).toHaveCount(0);
  await expect(portal.getByText("vendor-case.txt")).toHaveCount(0);
  await expect(portal.getByRole("tab", { name: "Internal note" })).toHaveCount(0);
  // No routing controls for requesters.
  await expect(portal.getByLabel("Assignee", { exact: true })).toHaveCount(0);
  await expect(portal.getByTestId("status-menu")).toHaveCount(0);
});

test("requester submits a request, attaches a file, and the agent downloads it", async ({ browser }) => {
  const portal = await (await sessionFor(browser, REQUESTER)).newPage();
  await portal.goto(`${BASE}/tickets`);
  await expect(portal.getByRole("heading", { name: "My requests" })).toBeVisible();
  await portal.getByRole("link", { name: "New request" }).click();
  await expect(portal.getByLabel("Assignee", { exact: true })).toHaveCount(0);
  const title = unique("Need access to the fuel card portal");
  await portal.getByLabel("Title").fill(title);
  await portal.getByRole("button", { name: "Submit request" }).click();
  await expect(portal).toHaveURL(/\/tickets\/IT-\d{6}$/);
  const key = portal.url().split("/").pop()!;

  await portal
    .getByLabel("Upload files")
    .setInputFiles({ name: "approval.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 approval") });
  await expect(portal.getByTestId("attachment-row").filter({ hasText: "approval.pdf" })).toBeVisible();
  // Disallowed types are rejected with a clear message.
  await portal
    .getByLabel("Upload files")
    .setInputFiles({ name: "evil.html", mimeType: "text/html", buffer: Buffer.from("<script>") });
  await expect(portal.getByText(/evil\.html: This file type isn't allowed/)).toBeVisible();

  const agent = await (await sessionFor(browser, AGENT)).newPage();
  await agent.goto(`${BASE}/tickets/${key}`);
  const download = agent.waitForEvent("download");
  await agent
    .getByTestId("attachment-row")
    .getByRole("button", { name: /^approval\.pdf \(/ })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("approval.pdf");
  expect(await readFile(await file.path(), "utf8")).toBe("%PDF-1.4 approval");
});

test("tickets can be linked by key and found with filters", async ({ browser }) => {
  const page = await (await sessionFor(browser, AGENT)).newPage();
  const parent = await createTicketAsAgent(page, unique("Root cause: DHCP pool exhausted"));
  const childTitle = unique("Wi-Fi clients get no IP");
  const child = await createTicketAsAgent(page, childTitle);
  await page.getByRole("button", { name: "Link" }).click();
  await chooseOption(page, "Link type", "Caused by");
  await page.getByLabel("Ticket key").fill(parent.toLowerCase());
  await page.getByRole("button", { name: "Add link" }).click();
  const related = page.getByRole("region", { name: "Related tickets" });
  await expect(related.getByRole("link", { name: new RegExp(parent) })).toBeVisible();

  await related.getByRole("link", { name: new RegExp(parent) }).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${parent}$`));
  await expect(page.getByRole("region", { name: "Related tickets" })).toContainText("Causes");

  await page.goto(`${BASE}/tickets`);
  await page.getByLabel("Search tickets").fill(childTitle.split(" ").slice(-1)[0]!);
  await page.getByLabel("Search tickets").press("Enter");
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByTestId("ticket-row")).toHaveCount(1);
  await expect(page.getByTestId("ticket-row")).toContainText(child);
});

test("admins configure categories and custom fields that forms then use", async ({ browser }) => {
  const page = await (await sessionFor(browser, ADMIN)).newPage();
  const category = unique("Telematics");
  await page.goto(`${BASE}/settings/tickets`);
  await page.getByLabel("New category").fill(category);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(category)).toBeVisible();

  await page.getByRole("tab", { name: "Custom fields" }).click();
  const field = unique("Vehicle VIN");
  await page.getByLabel("Label").fill(field);
  await page.getByLabel("Required").check();
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText(field, { exact: true })).toBeVisible();

  await page.goto(`${BASE}/tickets/new`);
  await page.getByLabel("Title").fill(unique("Tracker offline"));
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page.getByText(`${field} is required.`)).toBeVisible();
  await page.getByLabel(field).fill("1FUJGLDR0CLBP8834");
  await chooseOption(page, "Category", category);
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/IT-\d{6}$/);
  await expect(page.getByRole("region", { name: "Ticket properties" })).toContainText("1FUJGLDR0CLBP8834");
  await expect(page.getByLabel("Category", { exact: true })).toContainText(category);
});

test("agents cannot reach ticket configuration", async ({ browser }) => {
  const page = await (await sessionFor(browser, AGENT)).newPage();
  expect((await page.goto(`${BASE}/settings/tickets`))?.status()).toBe(404);
});
