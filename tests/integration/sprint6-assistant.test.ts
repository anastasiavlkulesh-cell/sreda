import { describe, it, expect } from "vitest";
import { createDemoOrganization } from "@/server/services/demo";
import { askAssistant, assistantHistory } from "@/server/services/assistant";
import { newUser, ctxFor } from "./helpers";

describe("AI-помощник", () => {
  it("отвечает на вопросы ТЗ по данным компании, с источниками и ограничениями", async () => {
    const u = await newUser("as");
    const org = await createDemoOrganization(u.id);
    const ctx = await ctxFor(u.id, org.id);
    const crit = await askAssistant(ctx, "Какие проблемы самые критичные?");
    expect(crit.role).toBe("Service Auditor");
    expect(crit.facts.length).toBeGreaterThan(0);
    expect(crit.sources.join(" ")).toMatch(/SERVICE 5D/);
    const rev = await askAssistant(ctx, "Что мешает росту выручки?");
    expect(rev.role).toBe("Business Advisor");
    expect(rev.limitations.join(" ")).toMatch(/не доказана/);
    const res = await askAssistant(ctx, "Какой результат дали предыдущие изменения?");
    expect(res.text).toMatch(/подтвердил улучшение/);
    const tr = await askAssistant(ctx, "Кого нужно обучить?");
    expect(tr.text).toMatch(/не принимает кадровых решений/);
    expect((await assistantHistory(ctx)).length).toBe(4);
  });
});
