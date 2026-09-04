/**
 * يعيد قراءة الحركات المخزّنة بالمحرّك الجديد، ويحفظ قراره وأدلّته.
 *
 *   npm run db:rematch           يعرض ولا يكتب
 *   npm run db:rematch -- apply   ينفّذ
 *
 * ولا يُنشئ دفعات ولا يفكّ مطابقةً قائمة: يكتب التصنيف والمستفيد
 * والقرار والأدلّة فقط. أمّا إنشاء الدفعات فمن مسار الاستيراد بعد
 * موافقتك، لا من نصّ يُشغَّل في طرفيّة.
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { runReconciliation } from "../src/services/reconcile.service";
import type { SupplierIdentity } from "../src/lib/bank/entities";
import type { OpenInvoice } from "../src/lib/bank/candidates";

const APPLY = process.argv.includes("apply");

async function main() {
  const suppliers: SupplierIdentity[] = (
    await db.execute<Record<string, string | null>>(sql`
      select s.id, s.name_ar, s.slug, s.name_en, s.drive_folder_name,
             coalesce(string_agg(a.value, '||'), '') as aliases
      from suppliers s left join supplier_aliases a on a.supplier_id = s.id
      where s.is_active group by s.id
    `)
  ).rows.map((r) => ({
    supplierId: r.id as string,
    nameAr: r.name_ar as string,
    slug: r.slug as string,
    nameEn: r.name_en,
    driveFolderName: r.drive_folder_name,
    aliases: (r.aliases as string).split("||").filter(Boolean),
  }));

  const invoices: OpenInvoice[] = (
    await db.execute<Record<string, string | number>>(sql`
      select i.id, i.supplier_id, i.invoice_number, i.invoice_date, i.period_month,
             i.total_minor,
             i.total_minor - coalesce((select sum(pa.amount_minor)::int
               from payment_allocations pa where pa.invoice_id = i.id), 0) as outstanding
      from invoices i
      where i.supplier_id is not null
        and i.total_minor > coalesce((select sum(pa.amount_minor)::int
              from payment_allocations pa where pa.invoice_id = i.id), 0)
    `)
  ).rows.map((r) => ({
    id: r.id as string,
    supplierId: r.supplier_id as string,
    invoiceNumber: (r.invoice_number as string) ?? null,
    invoiceDate: new Date(r.invoice_date as string),
    periodMonth: r.period_month as string,
    totalMinor: Number(r.total_minor),
    outstandingMinor: Number(r.outstanding),
  }));

  const rows = (
    await db.execute<Record<string, string | number | null>>(sql`
      select id, description, beneficiary_raw, transaction_type, amount_minor,
             direction::text as direction, value_date, matched_payment_id
      from bank_transactions
    `)
  ).rows;

  const { results, summary } = runReconciliation({
    rows: rows.map((r) => ({
      key: r.id as string,
      valueDate: new Date(r.value_date as string),
      description: r.description as string | null,
      beneficiaryRaw: r.beneficiary_raw as string | null,
      transactionType: r.transaction_type as string | null,
      amountMinor: Number(r.amount_minor),
      direction: r.direction as "DEBIT" | "CREDIT",
    })),
    invoices,
    suppliers,
  });

  const alreadyMatched = new Set(
    rows.filter((r) => r.matched_payment_id).map((r) => r.id as string),
  );

  console.log(`الحركات ${summary.total}`);
  console.log(`  ليست سداد مورّد : ${summary.notPayment}`);
  console.log(`  عُرفت           : ${summary.understood}`);
  console.log(`\n=== قرار المحرّك ===`);
  console.log(`  تلقائيّ : ${summary.auto}`);
  console.log(`  اقتراح  : ${summary.suggest}`);
  console.log(`  مراجعة  : ${summary.review}`);
  console.log(`\nمطابَقة سابقاً بدفعة (لا تُمَسّ): ${alreadyMatched.size}`);

  if (!APPLY) {
    console.log("\nعرضٌ فقط. للتنفيذ:  npm run db:rematch -- apply");
    process.exit(0);
  }

  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < results.length; i += CHUNK) {
    const slice = results.slice(i, i + CHUNK);
    await db.transaction(async (t) => {
      for (const r of slice) {
        await t.execute(sql`
          update bank_transactions set
            category          = ${r.category}::tx_category,
            supplier_id       = ${r.supplierId},
            match_disposition = ${r.decision?.disposition ?? null}::match_disposition,
            match_score       = ${r.candidate ? Math.round(r.candidate.score * 100) : null},
            match_outcome     = ${r.outcome},
            match_evidence    = ${JSON.stringify({
              تصنيف: r.classificationReason,
              مستفيد: r.supplierEvidence,
              مطابقة: r.decision?.reasons ?? [],
              درجةالمستفيد: Math.round(r.supplierScore * 100),
            })}::jsonb
          where id = ${r.key}
        `);
        written++;
      }
    });
  }
  console.log(`\n✓ كُتبت أدلّة ${written} حركة`);
  process.exit(0);
}
main();
