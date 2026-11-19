import { NextResponse } from "next/server";
import { markOverdueTasks } from "@/server/services/tasks";

/** Плановая задача: отметка просроченных задач и уведомления. Вызывать раз в час: Authorization: Bearer CRON_SECRET */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const count = await markOverdueTasks();
  return NextResponse.json({ ok: true, markedOverdue: count });
}
