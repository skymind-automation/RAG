import { expect, test, type Page } from "@playwright/test";
import { sessionFor } from "./helpers";

/**
 * Phase 3 end to end: My Work views, the Kanban board (menu, keyboard and
 * mouse moves; optimistic update with rollback; resolution prompt), and
 * time tracking.
 */

const AGENT = "luis.ortega@delta.example";
const VIEWER = "grace.kim@delta.example";
const BASE = "/o/delta-ops";

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}`;
}

async function newTicket(page: Page, title: string): Promise<string> {
  await page.goto(`${BASE}/tickets/new`);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Assignee", { exact: true }).click();
  await page.getByRole("option", { name: "Luis Ortega", exact: true }).click();
  await page.getByRole("button", { name: "Create ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/IT-\d{6}$/);
  return page.url().split("/").pop()!;
}

const card = (page: Page, key: string) => page.locator(`[data-testid="board-card"][data-key="${key}"]`);
const column = (page: Page, c: string) => page.getByTestId(`column-${c}`);

test("My Work buckets the agent's tickets by the organization's calendar", async ({ browser }) => {
  const page = await (await sessionFor(browser, AGENT)).newPage();
  await page.goto(`${BASE}/my-work`);
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
  await page.getByRole("link", { name: /^Overdue/ }).click();
  await expect(page).toHaveURL(/view=overdue/);
  await expect(page.getByTestId("my-work-row")).toContainText(["IT-000013"]);
  await page.getByRole("link", { name: /^Today/ }).click();
  await expect(page.getByTestId("my-work-row").filter({ hasText: "IT-000007" })).toBeVisible();
  await page.getByRole("link", { name: /^Watching/ }).click();
  await expect(page.getByTestId("my-work-row").first()).toBeVisible();
});

test("board: move with the accessible menu and with the keyboard", async ({ browser }) => {
  const page = await (await sessionFor(browser, AGENT)).newPage();
  const key = await newTicket(page, unique("Board keyboard move"));
  await page.goto(`${BASE}/boards?assigneeId=me`);
  await expect(column(page, "NEW").locator(card(page, key))).toBeVisible();

  // 1. "Move to…" menu (the non-drag alternative).
  await page.getByRole("button", { name: `Move ${key} to…` }).click();
  await page.getByRole("menuitem", { name: "Open" }).click();
  await expect(column(page, "OPEN").locator(card(page, key))).toBeVisible();

  // 2. Keyboard: Escape cancels a pick-up…
  const handle = page.getByRole("button", { name: `Move ${key}`, exact: true });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(column(page, "IN_PROGRESS")).toHaveAttribute("data-keyboard-target", "true");
  await page.keyboard.press("Escape");
  await expect(column(page, "OPEN").locator(card(page, key))).toBeVisible();
  // …and Space, → (one column), Space moves it, keeping focus on the card.
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(column(page, "IN_PROGRESS").locator(card(page, key))).toBeVisible();
  await expect(page.getByRole("button", { name: `Move ${key}`, exact: true })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: `Moving ${key} to In Progress` })).toHaveCount(1);

  // Persisted on the server, not just in the optimistic cache.
  await page.reload();
  await expect(column(page, "IN_PROGRESS").locator(card(page, key))).toBeVisible();
});

test("board: mouse drag, resolution prompt, and rollback of disallowed moves", async ({ browser }) => {
  const page = await (await sessionFor(browser, AGENT)).newPage();
  const key = await newTicket(page, unique("Board mouse drag"));
  await page.goto(`${BASE}/boards?assigneeId=me`);

  // NEW → PENDING isn't allowed by the default workflow: optimistic move, then rollback.
  await page.getByRole("button", { name: `Move ${key} to…` }).click();
  await page.getByRole("menuitem", { name: "Pending" }).click();
  await expect(page.getByText(/doesn't allow moving from New/)).toBeVisible();
  await expect(column(page, "NEW").locator(card(page, key))).toBeVisible();

  // Mouse drag NEW → OPEN.
  const handle = page.getByRole("button", { name: `Move ${key}`, exact: true });
  const target = column(page, "OPEN");
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 15 });
  await page.mouse.up();
  await expect(column(page, "OPEN").locator(card(page, key))).toBeVisible();

  // OPEN → RESOLVED requires a resolution: the board asks for it.
  await page.getByRole("button", { name: `Move ${key} to…` }).click();
  await page.getByRole("menuitem", { name: "Resolved" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("requires a resolution")).toBeVisible();
  await dialog.getByLabel("Resolution").fill("Replaced the access point in bay 3.");
  await dialog.getByRole("button", { name: "Resolve" }).click();
  await expect(column(page, "RESOLVED").locator(card(page, key))).toBeVisible();
  await page.goto(`${BASE}/tickets/${key}`);
  await expect(page.getByRole("region", { name: "Resolution" })).toContainText("access point");
});

test("time tracking: timer with live sidebar indicator, and manual entries", async ({ browser }) => {
  const page = await (await sessionFor(browser, AGENT)).newPage();
  const key = await newTicket(page, unique("Time tracking"));
  const panel = page.getByTestId("time-panel");

  await panel.getByRole("button", { name: "Start timer" }).click();
  const indicator = page.getByTestId("running-timer");
  await expect(indicator).toContainText(key);
  await expect(indicator.locator("time")).toHaveText(/0:00:0[1-9]/, { timeout: 5000 }); // ticking
  // Visible on other pages too.
  await page.goto(`${BASE}/my-work`);
  await expect(page.getByTestId("running-timer")).toContainText(key);
  await page.getByTestId("running-timer").getByRole("button", { name: "Stop" }).click();
  await expect(page.getByTestId("running-timer")).toHaveCount(0);

  await page.goto(`${BASE}/tickets/${key}`);
  await expect(panel.getByTestId("time-entry")).toHaveCount(1);
  await panel.getByRole("button", { name: "Log time" }).click();
  await panel.getByLabel("Hours").fill("1");
  await panel.getByLabel("Minutes").fill("15");
  await panel.getByLabel("What did you do?").fill("Vendor call");
  await panel.getByLabel("Billable").check();
  await panel.getByRole("button", { name: "Log", exact: true }).click();
  await expect(panel.getByTestId("time-entry")).toHaveCount(2);
  await expect(panel.getByLabel("Total logged time")).toContainText("1h 15m billable");
  await expect(page.getByTestId("timeline-event").filter({ hasText: "logged 1h 15m (billable)" })).toBeVisible();
});

test("viewers see a read-only board and no time controls", async ({ browser }) => {
  const page = await (await sessionFor(browser, VIEWER)).newPage();
  await page.goto(`${BASE}/boards`);
  await expect(page.getByText(/Read-only/)).toBeVisible();
  await expect(page.getByTestId("board-card").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Move IT-/ })).toHaveCount(0);
  expect((await page.goto(`${BASE}/my-work`))?.status()).toBe(404);
  await page.goto(`${BASE}/tickets/IT-000001`);
  await expect(page.getByTestId("time-panel")).toBeVisible(); // reports.read may view
  await expect(page.getByRole("button", { name: "Start timer" })).toHaveCount(0);
});
