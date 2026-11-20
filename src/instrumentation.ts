/**
 * Встроенный планировщик для платформ без cron (Timeweb App Platform и аналоги).
 * Включается переменной INTERNAL_SCHEDULER=1. Вызывает защищённые эндпоинты
 * самого приложения, поэтому логика плановых задач одна для cron и для планировщика.
 * Рассчитан на один экземпляр приложения.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.INTERNAL_SCHEDULER !== "1") return;
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(JSON.stringify({ level: "warn", msg: "scheduler.disabled_no_cron_secret" }));
    return;
  }
  const port = process.env.PORT ?? "3000";
  const hourMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 3_600_000);
  let lastRetention = 0;

  const call = async (path: string) => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
      console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "scheduler.run", path, status: res.status }));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "scheduler.failed", path, error: String(e) }));
    }
  };

  const tick = async () => {
    await call("/api/cron/overdue");
    if (Date.now() - lastRetention >= 24 * hourMs) {
      lastRetention = Date.now();
      await call("/api/cron/retention");
    }
  };

  // Первый запуск — через минуту после старта, когда сервер уже принимает запросы.
  setTimeout(() => void tick(), Math.min(60_000, hourMs)).unref();
  setInterval(() => void tick(), hourMs).unref();
}
