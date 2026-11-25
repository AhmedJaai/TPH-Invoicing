/**
 * محرّكُ التنبّؤ الليليّ (`forecast/` — Python على GitHub Actions) يقرأ ويكتب من هنا وحده:
 *
 *   GET  — ما بيع بالساعة والأصناف والأحداث (`loadForecastHistory`).
 *   POST — ما تنبّأ به، مضغوطاً بـgzip، يُفحص بـzod ثمّ يُكتب في جداول `forecast_*` وحدها.
 *
 * بسرّ `CRON_SECRET` وحده. ولا يملك المحرّكُ اتّصالاً بالقاعدة: ما يرسله لا يصل إلى مالٍ
 * ولا جردٍ ولا مطابقة — صفحةٌ منعزلة تعرض المتوقَّع (أحمد، ٢٥ نوفمبر ٢٠٢٦).
 */
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { cronGuard, cronRefused, runCron } from "@/services/cron.service";
import { forecastRunSchema, ingestForecastRun, loadForecastHistory } from "@/services/forecast.service";

export const runtime = "nodejs";
export const maxDuration = 120;

/** أكبرُ جسمٍ بعد فكّ الضغط — التشغيلُ الواحد نحو مليون حرف. */
const MAX_BODY_BYTES = 20_000_000;

async function refuse(request: Request): Promise<NextResponse | null> {
  try {
    await cronGuard(request, "amounts:view");
    return null;
  } catch (e) {
    const refused = cronRefused(e, "cron/forecast");
    if (refused) return refused;
    throw e;
  }
}

export async function GET(request: Request) {
  const refused = await refuse(request);
  if (refused) return refused;
  return NextResponse.json({ ok: true, history: await loadForecastHistory() }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const refused = await refuse(request);
  if (refused) return refused;
  let raw: unknown;
  try {
    const buf = Buffer.from(await request.arrayBuffer());
    const text = (request.headers.get("content-encoding") === "gzip"
      ? gunzipSync(buf, { maxOutputLength: MAX_BODY_BYTES })
      : buf).toString("utf8");
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "تعذّرت قراءة جسم التنبّؤ (gzip أو JSON)" }, { status: 400 });
  }
  const parsed = forecastRunSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ ok: false, error: `تنبّؤٌ غير مفهوم (${issue?.path.join(".")}): ${issue?.message}` }, { status: 400 });
  }
  return runCron("forecast", async () => {
    const r = await ingestForecastRun(parsed.data);
    return { ok: true, result: `تنبّؤ ${parsed.data.issuedOn}: ${r.points} نقطة`, record: true };
  });
}
