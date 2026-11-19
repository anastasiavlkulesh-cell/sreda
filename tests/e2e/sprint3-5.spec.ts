import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "demo@sreda.local");
  await page.fill("#password", "DemoSreda2026");
  await page.click("button[type=submit]");
  await page.waitForURL(/dashboard/);
});

test("проблемы: статусы выводов, причины и доказательства", async ({ page }) => {
  await page.goto("/problems");
  await expect(page.getByText("Подтверждено").first()).toBeVisible();
  await page.getByText("Низкий уровень: скорость обслуживания").click();
  await expect(page.getByRole("heading", { name: "Первопричины" })).toBeVisible();
  await expect(page.getByText("Реализуемость (отдельно)")).toBeVisible();
  await expect(page.getByText("Клиенты: «Скорость обслуживания»")).toBeVisible();
});

test("план → задачи: демо-план утверждён, видны результаты повторного замера", async ({ page }) => {
  await page.goto("/plan");
  await page.getByText("План улучшений: Диагностика SERVICE 5D — весна").click();
  await expect(page.getByText("Утверждён").first()).toBeVisible();
  await expect(page.getByText("Улучшение подтверждено замером").first()).toBeVisible();
  await expect(page.getByText("Эффект не подтверждён").first()).toBeVisible();
  await page.goto("/tasks?status=IN_REVIEW");
  await page.locator("main a[href^='/tasks/c']").first().click();
  await expect(page.getByText("AI-проверка доказательств")).toBeVisible();
  await expect(page.getByRole("button", { name: "Принять" })).toBeVisible();
});

test("команда: результаты пульс-опроса без индивидуальных ответов", async ({ page }) => {
  await page.goto("/team");
  await expect(page.getByText("Риск перегрузки")).toBeVisible();
  await expect(page.getByText("Группы меньше 5 человек скрыты")).toBeVisible();
});

test("отчёт: PDF формируется и открывается", async ({ page }) => {
  await page.goto("/reports");
  await page.click("button:has-text('Сформировать')");
  await expect(page.getByText("Отчёт сформирован")).toBeVisible({ timeout: 30000 });
  const href = await page.locator("a:has-text('Открыть PDF')").first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
});

test("уведомления: колокольчик и список", async ({ page }) => {
  await page.click("a[href='/notifications']");
  await expect(page.getByRole("heading", { name: "Уведомления" })).toBeVisible();
  await expect(page.getByText("Анализ выявил критические проблемы").first()).toBeVisible();
});
