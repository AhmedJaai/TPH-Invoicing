/**
 * بندا نادك في فاتورة 2302070019776 (٢٦ نوفمبر) — قُرئت الكمّيّةُ «6» (حبّاتُ الكرتون) في
 * البندين، فصار سعرُ الحليب كامل الدسم ٢١٫٢٣ وقليل الدسم ١٫٥٢ وقيل «ارتفع ١٣٣٪».
 *
 * الصحيحُ من المجموع نفسه بسعر الحبّة ٩٫١٠ الذي طُبع في الخانة («54.60 / 9.10»): ١٤ حبّة
 * (١٢٧٫٤٠) وحبّةٌ واحدة (٩٫١٠) — وصافي الفاتورة ١٣٦٫٥٠ يساويهما. تُصحَّح الكمّيّة بمسار
 * الشاشة نفسه (`correctInvoiceLine`): المجموعُ لا يتغيّر، والسعرُ يُشتقّ منه، وتشغيلُه مرّتين
 * لا يغيّر شيئاً. والقراءاتُ القادمة يصحّحها `packQuantity` في `line-pricing.ts`.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-11-27.ts [--i-know-this-is-production]
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { correctInvoiceLine } from "@/services/invoice-correction.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const FIXES = [
  { lineId: "b4ea399c-c389-4b62-af38-21da0883d985", quantity: "14" },
  { lineId: "96574a78-4630-488f-bf5c-8e1aa6cfc865", quantity: "1" },
];

class Preview extends Error {}

async function main() {
  const show = async (label: string) => {
    const r = (await db.execute<{ d: string; qty: string | null; unit: number; total: number; basis: string | null }>(sql`
      select il.description d, il.qty::text qty, il.unit_price_minor unit, il.line_total_minor total, il.pricing_basis basis
        from invoice_lines il where il.id in (${sql.join(FIXES.map((f) => sql`${f.lineId}`), sql`, `)})`)).rows;
    console.log(label, r);
  };
  await show("قبل:");
  try {
    await db.transaction(async (t) => {
      for (const f of FIXES) {
        const out = await correctInvoiceLine(t, f, AHMED);
        console.log(out.changed ? "التصحيح:" : "لا شيء — البند مصحّح من قبل.", out);
      }
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
