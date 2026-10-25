/**
 * بندُ البنّ في فاتورة كوهي روستري INV1843 (١٩ أكتوبر) — بقول أحمد (٢٥ أكتوبر ٢٠٢٦): «اشتريت ٥ كيلو».
 *
 * قرأه النموذج «١ × ٧٢٥»، والصحيحُ ٥ × ١٤٥: الفواتيرُ الثلاث قبلها من المورّد نفسه ٥ × ١٤٥، وفودكس
 * سجّل الشراء نفسه (PUR-000210) ٥ كيلو بـ٧٢٥. فتُصحَّح الكمّيّةُ بالمسار نفسه الذي تصحّحها به الشاشة
 * (`correctInvoiceLine`): المجموعُ ٧٢٥ لا يتغيّر، وسعرُ الوحدة يُشتقّ منه. وتشغيلُه مرّتين لا يغيّر شيئاً.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-25.ts [--i-know-this-is-production]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { correctInvoiceLine } from "@/services/invoice-correction.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const LINE = "351d52aa-8726-46e2-9489-847b529173f7";

class Preview extends Error {}

async function main() {
  const show = async (label: string) => {
    const [r] = (await db.execute<{ inv: string; d: string; qty: string | null; unit: number; total: number; basis: string | null }>(sql`
      select i.invoice_number inv, il.description d, il.qty::text qty, il.unit_price_minor unit, il.line_total_minor total, il.pricing_basis basis
        from invoice_lines il join invoices i on i.id = il.invoice_id where il.id = ${LINE}`)).rows;
    console.log(label, r);
  };
  await show("قبل:");
  try {
    await db.transaction(async (t) => {
      const out = await correctInvoiceLine(t, { lineId: LINE, quantity: "5" }, AHMED);
      console.log(out.changed ? "التصحيح:" : "لا شيء — البند مصحّح من قبل.", out);
      if (!WRITE) throw new Preview();
    });
  } catch (e) {
    if (!(e instanceof Preview)) throw e;
    console.log("معاينة — لم يُكتب شيء. أعِده بـ--i-know-this-is-production");
  }
  await show("بعد:");
  process.exit(0);
}
main().catch((e) => { console.error("✕", e); process.exit(1); });
