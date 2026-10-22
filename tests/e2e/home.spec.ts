import { test, expect } from "@playwright/test";

test("homepage loads and displays branding", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Scanly/i);
  await expect(page.getByRole("heading", { name: /scan documents/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /scan document/i })).toBeVisible();
});
