/**
 * حزمةُ المحاسب — ملفّ Excel لشهرٍ واحد بستّ أوراق.
 *
 *   GET /api/export/accountant?month=YYYY-MM
 *
 * لمن يقفل الشهر (`month:close`) — المالكُ والمحاسب. والتنزيلُ يُقيَّد في
 * سجلّ التدقيق: ملفٌّ فيه فواتيرُ الشهر ودفعاتُه يخرج من النظام.
 * والأوراقُ من اليمين إلى اليسار، والمالُ خلايا عدديّة بتنسيق المال
 * فيجمعها المحاسب، والمجهولُ نصُّ «غير معروف» فلا يُجمع صفراً.
 */
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { loadAccountantPack } from "@/services/accountant-pack.service";
import { summarize, type Cell } from "@/lib/accountant-pack";

export const runtime = "nodejs";
export const maxDuration = 60;

function toCell(c: Cell): XLSX.CellObject {
  if (typeof c === "string") return { t: "s", v: c };
  if ("count" in c) return { t: "n", v: c.count, z: "0" };
  /* النصُّ «1234.50» مكتوبٌ من هللاتٍ صحيحة — والعددُ هنا لإكسل وحده */
  return { t: "n", v: Number(c.riyals), z: "#,##0.00" };
}

export async function GET(request: Request) {
  let user;
  try {
    user = await guard("accountant-pack", "month:close");
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

    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: true }] };
    for (const s of sheets) {
      const ws: XLSX.WorkSheet = {};
      let maxCol = 0;
      s.rows.forEach((row, r) => {
        row.forEach((cell, c) => {
          ws[XLSX.utils.encode_cell({ r, c })] = toCell(cell);
          maxCol = Math.max(maxCol, c);
        });
      });
      ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, s.rows.length - 1), c: maxCol } });
      ws["!cols"] = Array.from({ length: maxCol + 1 }, () => ({ wch: 18 }));
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    const body = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

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

    return new NextResponse(new Uint8Array(body), {
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
