/**
 * سجلُّ إقرار الضريبة — ملفّ Excel للمحاسب: كلُّ خانةٍ بما جاءت منه.
 *
 *   GET /api/export/vat?period=2026-Q3   (أو YYYY-MM)
 *
 * من مادّة صفحة الإقرار نفسِها (`loadVatReturn`)، فلا يخالف رقمُه رقمَها. لمن يرى الصفحة
 * (`reports:export`)، والتنزيلُ يُقيَّد: ملفٌّ فيه فواتيرُ الفترة ومبيعاتُها يخرج من النظام.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { formatMonth, todayInRiyadh } from "@/lib/riyadh-time";
import { parseVatPeriod, periodKey, quarterLabel } from "@/lib/vat-return";
import { buildVatSheets } from "@/lib/vat-export";
import { sheetsToXlsx } from "@/lib/xlsx-sheets";
import { loadVatReturn } from "@/services/vat-return.service";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("vat-export", "reports:export");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const period = parseVatPeriod(new URL(request.url).searchParams.get("period"));
  if (!period) return NextResponse.json({ error: "اختر فترةً صحيحة (2026-Q3 أو YYYY-MM)." }, { status: 400 });
  const key = periodKey(period);

  try {
    const view = await loadVatReturn(period);
    const body = sheetsToXlsx(buildVatSheets({
      label: period.kind === "quarter" ? quarterLabel(period) : formatMonth(period.month),
      periodKey: key,
      generatedAt: todayInRiyadh(),
      result: view.result,
      invoices: view.invoices,
      txs: view.txs,
      cash: view.cash,
      /* لقطةُ التقديم للربع كاملاً — لا تُنسب لشهرٍ منه */
      filing: period.kind === "quarter" ? view.filing : null,
    }));

    await recordAudit({
      actorId: user.id,
      action: "VAT_RETURN_EXPORTED",
      entityType: "vat_period",
      entityId: key,
      after: {
        الفترة: key,
        "ضريبة المخرجات (هللة)": view.result.output.vatMinor,
        "ضريبة المدخلات (هللة)": view.result.input.totalMinor,
        "الصافي (هللة)": view.result.netMinor,
        فواتير: view.invoices.length,
      },
    });

    return new NextResponse(Buffer.from(body), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="vat-return-${key}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("[vat-export]", e);
    return NextResponse.json({ error: "تعذّر إعداد سجلّ الإقرار — لم يُكتب شيء. أعد المحاولة بعد لحظة." }, { status: 500 });
  }
}
