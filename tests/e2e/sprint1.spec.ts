import { test, expect, type Page } from "@playwright/test";

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function register(page: Page, name: string, email: string, url = "/register") {
  await page.goto(url);
  await page.fill("#name", name);
  if (await page.locator("#email").isEditable()) await page.fill("#email", email);
  await page.fill("#password", "Password12345");
  await page.check("input[name=consent]");
  await page.click("button[type=submit]");
}

test("собственник регистрируется, создаёт компанию и видит пустую панель", async ({ page }) => {
  const email = `owner${uniq()}@e2e.local`;
  await register(page, "Ольга Собственник", email);
  await page.waitForURL(/onboarding/);
  await page.fill("#name", "ООО Тест E2E");
  await page.fill("#locationName", "Главная точка");
  await page.click("form >> text=Создать компанию");
  await page.waitForURL(/dashboard/);
  await expect(page.getByRole("heading", { name: "Главная панель" })).toBeVisible();
  await expect(page.getByText("Диагностика ещё не проводилась")).toBeVisible();
  await expect(page.getByText("ООО Тест E2E")).toBeVisible();
});

test("приглашённый сотрудник получает только разрешённые разделы", async ({ page, browser }) => {
  const ownerEmail = `owner${uniq()}@e2e.local`;
  await register(page, "Пётр Собственник", ownerEmail);
  await page.waitForURL(/onboarding/);
  await page.fill("#name", "ООО Права");
  await page.fill("#locationName", "Точка");
  await page.click("form >> text=Создать компанию");
  await page.waitForURL(/dashboard/);

  await page.goto("/settings?tab=members");
  const empEmail = `emp${uniq()}@e2e.local`;
  await page.fill("#inv-email", empEmail);
  await page.selectOption("#inv-role", "EMPLOYEE");
  await page.click("text=Создать приглашение");
  const link = await page.locator("input[readonly]").inputValue();
  expect(link).toContain("/invite/");

  const ctx2 = await browser.newContext({ locale: "ru-RU" });
  const p2 = await ctx2.newPage();
  await p2.goto(link);
  await p2.click("text=Зарегистрироваться и принять");
  await p2.waitForURL(/register\?invite=/);
  await register(p2, "Иван Сотрудник", empEmail, p2.url());
  // Сотрудник попадает в первый доступный ему раздел, а не на онбординг
  await p2.waitForURL((u) => !u.pathname.startsWith("/register") && !u.pathname.startsWith("/onboarding"));
  await expect(p2.getByText("ООО Права")).toBeVisible();
  await p2.goto("/settings");
  await expect(p2.getByRole("link", { name: "Пользователи" })).toHaveCount(0);
  await expect(p2.getByRole("link", { name: "Мои уведомления" })).toBeVisible();
  await p2.goto("/dashboard");
  await expect(p2).toHaveURL(/forbidden/);
  await ctx2.close();
});

test("неверный пароль не пускает в систему", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "nobody@e2e.local");
  await page.fill("#password", "wrong-password1");
  await page.click("button[type=submit]");
  await expect(page.getByText("Неверный e-mail или пароль")).toBeVisible();
});

test("неавторизованный пользователь перенаправляется на вход", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/login/);
});
