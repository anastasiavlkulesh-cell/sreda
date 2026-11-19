import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "demo@sreda.local");
  await page.fill("#password", "DemoSreda2026");
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/);
});

test("диагностика: создание, запуск, анонимная анкета по ссылке, учёт ответа", async ({ page, browser }) => {
  await page.goto("/diagnostics/new");
  await page.fill("#title", `E2E диагностика ${Date.now()}`);
  await page.click("text=Создать диагностику");
  await page.waitForURL(/\/diagnostics\/[^/]+$/);
  await expect(page.getByText("Черновик")).toBeVisible();
  await page.click("text=Запустить сбор данных");
  const row = page.locator("tr", { hasText: "Сотрудники" });
  await expect(row.locator("input[readonly]").first()).toBeVisible();
  const link = await row.locator("input[readonly]").first().inputValue();
  expect(link).toMatch(/\/s\//);

  const anon = await browser.newContext({ locale: "ru-RU" });
  const p = await anon.newPage();
  await p.goto(link);
  await expect(p.getByText("Опрос анонимный")).toBeVisible();
  const fieldsets = p.locator("fieldset");
  const count = await fieldsets.count();
  for (let i = 0; i < count; i++) {
    const radio = fieldsets.nth(i).locator("label", { hasText: "Отчасти" });
    if (await radio.count()) await radio.click();
  }
  await p.click("text=Отправить ответы");
  await p.waitForURL(/thanks/);
  await expect(p.getByRole("heading", { name: "Спасибо, ответы сохранены" })).toBeVisible();
  // Повторно с того же устройства отправить нельзя
  await p.goto(link);
  for (let i = 0; i < count; i++) {
    const radio = fieldsets.nth(i).locator("label", { hasText: "Отчасти" });
    if (await radio.count()) await radio.click();
  }
  await p.click("text=Отправить ответы");
  await expect(p.getByText("уже заполнена")).toBeVisible();
  await anon.close();

  await page.reload();
  await expect(page.locator("tr", { hasText: "Сотрудники" }).getByText("1", { exact: true })).toBeVisible();
});

test("результаты демо-диагностики показывают расчёт по критериям и источникам", async ({ page }) => {
  await page.goto("/diagnostics");
  await page.click("text=Диагностика SERVICE 5D — текущая");
  await expect(page.getByText("Результат SERVICE 5D")).toBeVisible();
  await expect(page.getByText("Скорость обслуживания").first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Тайный покупатель" }).first()).toBeVisible();
});
