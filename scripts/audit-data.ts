/**
 * تدقيق اكتمال البيانات وسلامتها.
 *
 *   npm run db:audit
 *
 * لا يعدّل شيئاً. يقول ما هو معلوم وما هو مجهول وما هو مكسور — والمجهول
 * يُسمّى مجهولاً ولا يُملأ بصفر.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildDataHealth } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { formatRiyalsDisplay } from "@/lib/money";

async function main() {
  const facts = await gatherHealthFacts();
  const health = buildDataHealth(facts);

  console.log("\n═══════════ صحّة البيانات ═══════════\n");
  for (const m of health.metrics) {
    const icon =
      m.state === "GOOD" ? "✓" : m.state === "NOT_CONNECTED" ? "—" : m.state === "MISSING" ? "✕" : "⚠";
    const cov = m.coverage === null ? "غير موصول" : `${Math.round(m.coverage * 100)}٪`.padStart(5);
    console.log(`  ${icon} ${m.label.padEnd(26)} ${cov}   ${m.detail}`);
    if (m.action) console.log(`      ← ${m.action}`);
  }
  console.log(`\n  ثقة الأرقام المالية: ${Math.round(health.confidence * 100)}٪`);

  console.log("\n═══════════ سلامة السجلات ═══════════\n");
  const checks = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from invoices where subtotal_minor is null)                as unknown_subtotal,
      (select count(*)::int from invoices where tax_status = 'UNKNOWN')                as unknown_tax,
      (select count(*)::int from invoices where subtotal_minor is not null
         and vat_minor is not null and subtotal_minor + vat_minor <> total_minor)      as arithmetic_off,
      (select count(*)::int from documents where sha256 is null)                       as docs_no_hash,
      (select count(*)::int from bank_transactions where external_id is null)          as tx_no_identity,
      (select count(*)::int from (
         select 1 from payments p join payment_allocations pa on pa.payment_id = p.id
         group by p.id, p.amount_minor
         having coalesce(sum(pa.amount_minor),0) > p.amount_minor) t)                  as over_allocated,
      (select count(*)::int from (
         select 1 from invoices i join payment_allocations pa on pa.invoice_id = i.id
         group by i.id, i.total_minor
         having coalesce(sum(pa.amount_minor),0) > i.total_minor + 1) t)               as over_paid,
      (select count(*)::int from issues where status = 'OPEN' and severity = 'BLOCKER') as open_blockers,
      (select count(*)::int from documents where status in ('PENDING','NEEDS_REVIEW'))  as pending_docs
  `);
  const c = checks.rows[0] ?? {};

  const line = (label: string, n: number, tone: "info" | "bad" = "bad") =>
    console.log(`  ${n === 0 || tone === "info" ? "✓" : "⚠"} ${label.padEnd(38)} ${n}`);

  line("فواتير صافيها مجهول (مُعلَن لا مُصفَّر)", Number(c.unknown_subtotal ?? 0), "info");
  line("فواتير حالتها الضريبية مجهولة", Number(c.unknown_tax ?? 0), "info");
  line("فواتير حسابها لا يستقيم", Number(c.arithmetic_off ?? 0));
  line("مستندات بلا بصمة", Number(c.docs_no_hash ?? 0));
  line("حركات بنكية بلا هوية", Number(c.tx_no_identity ?? 0));
  line("دفعات تخصيصها يتجاوز قيمتها", Number(c.over_allocated ?? 0));
  line("فواتير خُصّص لها أكثر من قيمتها", Number(c.over_paid ?? 0));
  line("تنبيهات مانعة مفتوحة", Number(c.open_blockers ?? 0));
  line("مستندات معلّقة", Number(c.pending_docs ?? 0));

  const [totals] = (
    await db.execute<{ n: number; s: string; unpaid: string }>(sql`
      select count(*)::int as n,
             coalesce(sum(total_minor),0)::bigint as s,
             coalesce(sum(greatest(0, total_minor - coalesce((
               select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
             ),0))),0)::bigint as unpaid
      from invoices
    `)
  ).rows;

  console.log(`\n  ${totals?.n ?? 0} فاتورة بقيمة ${formatRiyalsDisplay(Number(totals?.s ?? 0))} ريال`);
  console.log(`  غير مسدَّد منها ${formatRiyalsDisplay(Number(totals?.unpaid ?? 0))} ريال\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
