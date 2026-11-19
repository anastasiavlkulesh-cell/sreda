import { NextResponse } from "next/server";
import { applyRetention } from "@/server/services/retention";

/** Плановая задача: применение политики хранения. Вызывать раз в сутки: Authorization: Bearer CRON_SECRET */
export async function POST(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ ok: true, ...(await applyRetention()) });
}
