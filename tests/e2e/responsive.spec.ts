import { test, expect } from "@playwright/test";

test("смартфон: меню открывается, панель и задачи читаются без горизонтальной прокрутки", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "demo@sreda.local");
  await page.fill("#password", "DemoSreda2026");
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/);
  await expect(page.getByRole("heading", { name: "Главная панель" })).toBeVisible();
  for (const path of ["/dashboard", "/tasks", "/problems", "/team"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `горизонтальная прокрутка на ${path}`).toBeLessThanOrEqual(1);
  }
  await page.click("button[aria-label='Открыть меню']");
  await page.getByRole("link", { name: "Задачи" }).click();
  await expect(page).toHaveURL(/tasks/);
});

test("смартфон: сотрудник видит только свои задачи", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "employee@sreda.local");
  await page.fill("#password", "DemoSreda2026");
  await page.click("button[type=submit]");
  await page.waitForURL(/tasks/);
  await expect(page.getByRole("heading", { name: "Мои задачи" })).toBeVisible();
  await expect(page.locator("main a[href^='/tasks/c']")).toHaveCount(1);
});
