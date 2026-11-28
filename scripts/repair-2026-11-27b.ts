/**
 * أربعُ فواتير نادك قُرئ فيها مجموعُ البند نفسُه خطأً — لا الكمّيّةُ وحدها — فلا يصحّحها `packQuantity`
 * ولا `correctInvoiceLine` (الذي يُبقي المجموع). قُرئت من ملفّاتها في الدرايف (٢٧ نوفمبر ٢٠٢٦):
 *
 *   2340058134844  «+1 / 5» = ١١ حبّة كامل الدسم 1.75L  → ١٠٠٫١٠ (كان ٦ × ٩٫١٠ = ٥٤٫٦٠)
 *   2340058133106  «+2 / 3» = ١٥ حبّة كامل الدسم 1.75L  → ١٣٦٫٥٠ (كان ٦ «طويل الأجل 1 لتر» = ٥٤٫٦٠)
 *   2340058134583  «+1 / 5» = ١١ حبّة كامل الدسم 1.75L  → ١٠٠٫١٠ (كان ٦ = ٥٤٫٦٠)
 *   2340058135104  ١٥ حبّة كامل الدسم + حبّة قليل الدسم → ١٣٦٫٥٠ + ٩٫١٠ (كان «طازج 1 لتر» ٦ = ٥٤٫٦٠ + ١)
 *   2340058133702  «+2 / 3» = ١٥ حبّة كامل الدسم 1.75L  → ١٣٦٫٥٠ (كان ٦ = ٥٤٫٦٠)
 *
 * طُبِّق ٢٨ نوفمبر ٢٠٢٦ بعد فتح الأشهر من «إقفال الشهر»، ونُقلت 2340058134844 إلى ٥ أكتوبر
 * (مطبوعٌ «05-10-2026» وقُرئ مايو؛ رقمُها بين فاتورتَي ٢٧ سبتمبر و١٠ أكتوبر)، ثمّ أُعيد الإقفال.
 *
 * صافي كلّ فاتورة مقيَّدٌ صحيحاً من قبل ولا يتغيّر — البنودُ وحدها تُعاد إليه. والكتابةُ بمسار الاستيراد
 * نفسه (`replaceLines`) وفي شهرٍ مفتوح وحده (`assertMonthsOpen`): أشهرُ مايو ويوليو وسبتمبر وأكتوبر
 * مقفلة، فتُفتح من «إقفال الشهر» أوّلاً ثمّ تُقفل. وتشغيلُه مرّتين لا يغيّر شيئاً.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-11-27b.ts [--i-know-this-is-production]
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceLines, invoices } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { replaceLines } from "@/services/invoice.service";
import { assertMonthsOpen } from "@/services/month-guard";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const FF = "حليب كامل الدسم 1.75 لتر";
const LF = "حليب قليل الدسم 1.75 لتر";
const line = (description: string, quantity: number) => ({
  description, quantity: String(quantity), unitPrice: "9.10", lineTotal: ((quantity * 910) / 100).toFixed(2),
});
const FIXES: { number: string; lines: ReturnType<typeof line>[] }[] = [
  { number: "2340058134844", lines: [line(FF, 11)] },
  { number: "2340058133106", lines: [line(FF, 15)] },
  { number: "2340058134583", lines: [line(FF, 11)] },
  { number: "2340058135104", lines: [line(FF, 15), line(LF, 1)] },
  /* وُجدت بعد الأربع: بنودُها ٥٤٫٦٠ وصافيها ١٣٦٫٥٠ — «+2 / 3» = ١٥ حبّة */
  { number: "2340058133702", lines: [line(FF, 15)] },
];

class Preview extends Error {}

async function main() {
  try {
    await db.transaction(async (t) => {
      for (const f of FIXES) {
        const [inv] = await t.select({ id: invoices.id, supplierId: invoices.supplierId, date: invoices.invoiceDate, sub: invoices.subtotalMinor, month: invoices.periodMonth })
          .from(invoices).where(eq(invoices.invoiceNumber, f.number));
        const sum = f.lines.reduce((s, l) => s + Math.round(Number(l.lineTotal) * 100), 0);
        if (sum !== inv.sub) throw new Error(`${f.number}: البنود ${sum} لا تساوي الصافي ${inv.sub}`);
        const before = await t.select({ d: invoiceLines.description, q: invoiceLines.qty, u: invoiceLines.unitPriceMinor, total: invoiceLines.lineTotalMinor })
          .from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
        const already = before.length === f.lines.length && f.lines.every((l) =>
          before.some((b) => Number(b.q) === Number(l.quantity) && b.total === Math.round(Number(l.lineTotal) * 100) && b.u === 910));
        if (already) { console.log(f.number, "مصحّحة من قبل"); continue; }
        await assertMonthsOpen(t, [inv.month]);
        await replaceLines(t, { invoiceId: inv.id, supplierId: inv.supplierId, invoiceDate: inv.date, subtotalMinor: inv.sub, lines: f.lines });
        const after = await t.select({ d: invoiceLines.description, q: invoiceLines.qty, u: invoiceLines.unitPriceMinor, total: invoiceLines.lineTotalMinor, basis: invoiceLines.pricingBasis })
          .from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id));
        await recordAudit({
          actorId: AHMED, action: "INVOICE_LINE_CORRECTED", entityType: "invoice", entityId: inv.id,
          before: { البنود: before },
          after: { البنود: after, السبب: "قُرئ مجموعُ البند خطأً — من ملفّ الفاتورة في الدرايف (scripts/repair-2026-11-27b.ts)" },
        }, t);
        console.log(f.number, inv.month, "قبل:", before, "بعد:", after);
      }
      if (!WRITE) throw new Preview();
    });
  } catch (e) {
    if (!(e instanceof Preview)) throw e;
    console.log("معاينة — لم يُكتب شيء. أعِده بـ--i-know-this-is-production");
  }
  process.exit(0);
}
main().catch((e) => { console.error("✕", e instanceof Error ? e.message : e); process.exit(1); });
