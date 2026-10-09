/**
 * حزمةُ المحاسب — ملفّ Excel لشهرٍ واحد بستّ أوراق.
 *
 *   GET /api/export/accountant?month=YYYY-MM
 *
 * لمن يملك `reports:export` — المالكُ والمحاسب اليوم. والتنزيلُ يُقيَّد في
 * سجلّ التدقيق: ملفٌّ فيه فواتيرُ الشهر ودفعاتُه يخرج من النظام.
 * والأوراقُ من اليمين إلى اليسار، والمالُ خلايا عدديّة بتنسيق المال
 * فيجمعها المحاسب، والمجهولُ نصُّ «غير معروف» فلا يُجمع صفراً.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { loadAccountantPack } from "@/services/accountant-pack.service";
import { summarize } from "@/lib/accountant-pack";
import { sheetsToXlsx } from "@/lib/xlsx-sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("accountant-pack", "reports:export");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "اختر شهراً صحيحاً (YYYY-MM)." }, { status: 400 });
  }

  try {
    const { sheets, input } = await loadAccountantPack(month);

    const body = sheetsToXlsx(sheets);

    const sum = summarize(input);
    await recordAudit({
      actorId: user.id,
      action: "ACCOUNTANT_PACK_EXPORTED",
      entityType: "month",
      entityId: month,
      after: {
        الشهر: month,
        فواتير: sum.invoiceCount,
        "مجموع الفواتير بالهللات": sum.invoicesTotalMinor,
        دفعات: input.payments.length,
        مصروفات: input.expenses.length,
        "حركات البنك": input.bank.length,
        مقفل: input.closed,
      },
    });

    return new NextResponse(Buffer.from(body), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="accountant-pack-${month}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error("[accountant-pack]", e);
    return NextResponse.json({ error: "تعذّر إعداد الحزمة — لم يُكتب شيء. أعد المحاولة بعد لحظة." }, { status: 500 });
  }
}
