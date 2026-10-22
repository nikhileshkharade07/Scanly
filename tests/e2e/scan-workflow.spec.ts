import { test, expect } from "@playwright/test";

test.describe("Scanly Core User Workflows", () => {
  test("navigation across main pages works smoothly", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Scanly/i);

    // Navigate to Scan
    await page.click('a[href="/scan"]');
    await expect(page).toHaveURL(/\/scan/);
    await expect(page.getByRole("heading", { name: /new scan/i })).toBeVisible();

    // Navigate to Library
    await page.click('a[href="/library"]');
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible();

    // Navigate to Settings
    await page.click('a[href="/settings"]');
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();

    // Navigate to History
    await page.click('a[href="/history"]');
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole("heading", { name: /history/i })).toBeVisible();
  });

  test("settings page toggles theme and preferences", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText(/appearance/i)).toBeVisible();

    // Select light theme
    const lightButton = page.getByRole("button", { name: /^light$/i });
    await expect(lightButton).toBeVisible();
    await lightButton.click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Toggle back to dark theme
    const darkButton = page.getByRole("button", { name: /^dark$/i });
    await expect(darkButton).toBeVisible();
    await darkButton.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("image upload creates a document draft and opens editor", async ({ page }) => {
    await page.goto("/");

    // Trigger file input
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: /upload document/i }).click();
    const fileChooser = await fileChooserPromise;

    // Create a mock file buffer
    const buffer = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVNFLPAADlDQELkX3x6AAAAABJRU5ErkJggg==",
      "base64",
    );

    await fileChooser.setFiles({
      name: "test-scan-sample.png",
      mimeType: "image/png",
      buffer,
    });

    // Should navigate to document editor /documents/[id]
    await page.waitForURL(/\/documents\/.+/);
    await expect(page.getByRole("heading", { name: /test-scan-sample/i })).toBeVisible();

    // Verify page controls are available
    await expect(page.getByRole("button", { name: /run ocr/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /download image/i })).toBeVisible();

    // Test title renaming
    await page.getByRole("heading", { name: /test-scan-sample/i }).click();
    const input = page.locator('input[value="test-scan-sample"]');
    await expect(input).toBeVisible();
    await input.fill("Renamed Invoice");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByRole("heading", { name: /renamed invoice/i })).toBeVisible();

    // Verify document appears in Library
    await page.click('a[href="/library"]');
    await page.waitForURL(/\/library/);
    await expect(page.getByRole("heading", { name: /renamed invoice/i })).toBeVisible();

    // Verify Search filter
    const searchInput = page.getByPlaceholder(/search titles and recognized text/i);
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Renamed");
    await expect(page.getByRole("heading", { name: /renamed invoice/i })).toBeVisible();

    // Search for non-existent text
    await searchInput.fill("NonExistentXYZ999");
    await expect(page.getByText(/no documents match/i)).toBeVisible();

    // Clear search
    await searchInput.fill("");
    await expect(page.getByRole("heading", { name: /renamed invoice/i })).toBeVisible();
  });
});
