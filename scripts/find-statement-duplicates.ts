/**
 * قراءةٌ فقط — لا يكتب شيئاً (معاملةٌ `read only`، فلا يلزمه `guard-write`).
 *
 * يسرد ما يُشبه خطأ بيكوف (٢٤ أكتوبر ٢٠٢٦): «قيّد الناقصة من الكشف» قيّد سطراً مرجعُه مقروءٌ
 * خطأً («000285لـ#») فاتورةً ثانية، وهي 00346 المقيَّدة من ملفّها.
 *
 *   ١. فواتيرُ أصلُ مستندها سطرُ كشف (`documents.origin = 'STATEMENT_LINE'`) ولها أختٌ من المورّد
 *      نفسه باليوم والمبلغ نفسيهما — مرشّحةٌ لـ«نسخة مكرّرة؟ ادمجها» من صفحتها.
 *   ٢. فواتيرُ ملفُّها غاب من الدرايف (`FILE_MISSING_IN_DRIVE` مفتوح) وعليها تخصيصات —
 *      مرشّحةٌ لـ«حذف القيد» (أو نقل سدادها) من صفحتها.
 *   ٣. سداداتٌ بيدٍ مكرّرة (`hand-duplicate.service.ts`): قُيّدت بيد بلا حوالةٍ ولا إيصال وتظهر
 *      «رصيداً لك»، ولها توأمٌ مخصَّص بالمبلغ نفسه في سبعة أيّام أو فكّها دمجٌ أو «حذف القيد» —
 *      مود القهوة وجملة التقنية. مرشّحةٌ لـ«ألغِ القيد المكرّر» من صفحة المورّد.
 *
 * الإصلاحُ ضغطةُ المالك من الصفحة، لا من هنا.
 *
 *   npx tsx --env-file=.env scripts/find-statement-duplicates.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { formatRiyalsDisplay } from "../src/lib/money";
import { loadDuplicateHandPayments } from "../src/services/hand-duplicate.service";

type Twin = { supplier: string; id: string; number: string; day: string; total: number; twin_id: string; twin_number: string; twin_origin: string | null; twin_allocated: number; allocated: number };
type Missing = { supplier: string; id: string; number: string; day: string; total: number; allocated: number; file_name: string; payments: number };

async function main() {
  const out = await db.transaction(async (t) => {
    await t.execute(sql`set transaction read only`);
    const twins = (await t.execute<Twin>(sql`
      select s.name_ar as supplier, i.id, i.invoice_number as number, (i.invoice_date at time zone 'UTC')::date::text as day,
             i.total_minor as total, j.id as twin_id, j.invoice_number as twin_number, dj.origin as twin_origin,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as allocated,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = j.id), 0)::bigint as twin_allocated
        from invoices i
        join documents d on d.id = i.document_id and d.origin = 'STATEMENT_LINE'
        join suppliers s on s.id = i.supplier_id
        join invoices j on j.supplier_id = i.supplier_id and j.id <> i.id
         and (j.invoice_date at time zone 'UTC')::date = (i.invoice_date at time zone 'UTC')::date
         and abs(j.total_minor - i.total_minor) <= 1
        join documents dj on dj.id = j.document_id and dj.status <> 'REJECTED'
       where d.status <> 'REJECTED'
       order by s.name_ar, i.invoice_date, i.id`)).rows;

    const missing = (await t.execute<Missing>(sql`
      select s.name_ar as supplier, v.id, v.invoice_number as number, (v.invoice_date at time zone 'UTC')::date::text as day,
             v.total_minor as total, d.file_name,
             sum(pa.amount_minor)::bigint as allocated, count(distinct pa.payment_id)::int as payments
        from issues x
        join documents d on d.id = x.entity_id
        join invoices v on v.document_id = d.id
        join suppliers s on s.id = v.supplier_id
        join payment_allocations pa on pa.invoice_id = v.id
       where x.code = 'FILE_MISSING_IN_DRIVE' and x.status = 'OPEN'
       group by s.name_ar, v.id, v.invoice_number, v.invoice_date, v.total_minor, d.file_name
       order by s.name_ar, v.invoice_date`)).rows;
    /* الحكمُ نفسُه الذي تعرضه «يحتاج قرارك» وصفحةُ المورّد — لا نسخةٌ ثانية منه */
    const hand = await loadDuplicateHandPayments(t);
    return { twins, missing, hand };
  });

  const money = (m: number | string) => formatRiyalsDisplay(Number(m));
  console.log(`\n١. فواتير قُيّدت من سطر كشف ولها أخت باليوم والمبلغ نفسيهما: ${out.twins.length}`);
  for (const r of out.twins) {
    console.log(`  - ${r.supplier} · ${r.day} · ${money(r.total)} · «${r.number}» (${r.id}, مخصّص ${money(r.allocated)})`
      + ` ⟷ «${r.twin_number}» (${r.twin_id}${r.twin_origin === "STATEMENT_LINE" ? "، من كشف أيضاً" : ""}, مخصّص ${money(r.twin_allocated)})`);
  }
  console.log(`\n٢. فواتير غاب ملفها من الدرايف وعليها سداد: ${out.missing.length}`);
  for (const r of out.missing) {
    console.log(`  - ${r.supplier} · ${r.day} · «${r.number}» (${r.id}) · إجماليها ${money(r.total)} · مخصّص ${money(r.allocated)} من ${r.payments} دفعة · ${r.file_name}`);
  }
  console.log(`\n٣. دفعات قُيّدت مرتين بيدك وتظهر رصيداً للمورّد: ${out.hand.length}`);
  for (const d of out.hand) {
    console.log(`  - ${d.supplierName} · ${d.day} · ${d.method} · ${money(d.amountMinor)} (${d.paymentId}) · يظهر رصيداً ${money(d.creditMinor)} · ${d.why}`);
  }
  console.log("\nالإصلاح من صفحة كل فاتورة: «نسخة مكررة؟ ادمجهما» أو «احذف القيد»، ومن صفحة المورّد: «ألغِ القيد المكرّر». لم يُكتب شيء.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
