import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mobile navigation opens as an accessible drawer", async ({ page }) => {
  await login(page, "maya.chen@delta.example");
  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await expect(page.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\/o\/delta-ops\/teams$/);
  await expect(drawer).toBeHidden();
});
