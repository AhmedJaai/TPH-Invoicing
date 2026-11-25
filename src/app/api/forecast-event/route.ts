/**
 * ما يعرفه أحمد ولا تعرفه البيانات — إغلاقٌ أو نفادُ صنفٍ أو فعاليّة أو عرض — يُسجَّل للتنبّؤ.
 *
 * يقرؤه المحرّكُ الليليّ وحده: الإغلاقُ يُخرج اليومَ من التعلّم ويصفّر المستقبلَ منه، والنفادُ
 * يُخرج يومَ الصنف (ما بيع بعده ليس الطلب)، والفعاليّةُ متغيّرٌ يراه النموذج. لا مالَ هنا،
 * والإلغاءُ لا يحذف، وكلُّ كتابةٍ في سجلّ التدقيق.
 */
import { z } from "zod";
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { createForecastEvent, voidForecastEvent } from "@/services/forecast.service";
import { FORECAST_EVENT_KINDS } from "@/lib/forecast/events";

export const runtime = "nodejs";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صالح")
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "التاريخ غير صالح");

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    kind: z.enum(FORECAST_EVENT_KINDS),
    label: z.string().trim().min(2, "اكتب وصفاً قصيراً").max(120),
    fromDay: Day,
    toDay: Day,
    posProductId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullish(),
    fromHour: z.number().int().min(0).max(23).nullish(),
  }),
  z.object({ action: z.literal("void"), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }),
]);

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("forecast-event", "forecast:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const b = read.body;
  try {
    if (b.action === "void") {
      const ok = await voidForecastEvent(b.id, user.id);
      if (!ok) return NextResponse.json({ error: "الحدث غير موجود أو أُلغي. حدّث الصفحة." }, { status: 404 });
      return NextResponse.json({ ok: true, message: "أُلغي الحدث" });
    }
    if (b.fromDay > b.toDay) return NextResponse.json({ error: "بدايةُ الحدث بعد نهايته" }, { status: 400 });
    if (b.kind === "STOCKOUT" && !b.posProductId) return NextResponse.json({ error: "اختر الصنف الذي نفد" }, { status: 400 });
    const id = await createForecastEvent({
      kind: b.kind, label: b.label, fromDay: b.fromDay, toDay: b.toDay,
      posProductId: b.kind === "STOCKOUT" ? b.posProductId ?? null : null,
      fromHour: b.kind === "STOCKOUT" ? b.fromHour ?? null : null,
    }, user.id);
    return NextResponse.json({ ok: true, id, message: "سُجّل الحدث، ويراه التنبّؤُ الليلةَ القادمة" });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
