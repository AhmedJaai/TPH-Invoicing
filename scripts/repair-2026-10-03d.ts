/**
 * يعيد ربطَ أسطر كشف هنقري مان لمايو بفاتورتها الجامعة — فكّها `resync-statements.ts all`
 * (٣ أكتوبر ٢٠٢٦) لأنّ حارسه لم يعرف الجامعة. `recordStatementOnlyInvoices` يربطها بمقاطعها
 * الرقميّة ويعيد التنبيهات، ولا يقيّد شيئاً جديداً ما دام رقمُها عندنا.
 *
 * ثمّ تُعاد تنبيهاتُ كلّ كشف بالقواعد الحاليّة (`refreshStatementFindings`)، و«عندنا وليست في
 * كشفه» تُحسب من جديد في مدّته وبما طابقته كشوفُه الأخرى — كانت لكشوف غاناش من النافذة.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-03d.ts [--i-know-this-is-production]
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { issues, statementLines, statements } from "@/db/schema";
import { INVOICE, countNoun } from "@/lib/arabic";
import { ISSUE } from "@/lib/issue-codes";
import { reconcileAndPersist, refreshStatementFindings } from "@/services/statement-reconcile.service";
import { recordStatementOnlyInvoices } from "@/services/statement-invoices.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";

async function main() {
  const [st] = (await db.execute<{ id: string }>(sql`
    select st.id from statements st join documents d on d.id = st.document_id
     where d.file_name = '2026-05-31_HungryManBakery_Ledger_May_SAR240.00.pdf'`)).rows;
  if (!st) throw new Error("لم يُوجد الكشف");
  const count = async () => (await db.execute<{ s: string; n: number }>(sql`
    select match_status s, count(*)::int n from statement_lines where statement_id = ${st.id} group by 1`)).rows;
  console.log("قبل:", JSON.stringify(await count()));
  if (!WRITE) { console.log("— معاينة —"); process.exit(0); }
  const out = await db.transaction((t) => recordStatementOnlyInvoices(t, st.id, AHMED));
  console.log(`قُيِّد جديد: ${out.created.length} · رقمُه عندنا: ${out.alreadyRecorded}`);
  console.log("بعد:", JSON.stringify(await count()));

  for (const { id } of (await db.execute<{ id: string }>(sql`select id from statements`)).rows) {
    await db.transaction((t) => refreshStatementFindings(t, id));
    const [s] = await db.select({ supplierId: statements.supplierId, ob: statements.openingBalanceMinor, cb: statements.closingBalanceMinor })
      .from(statements).where(eq(statements.id, id));
    const lines = await db.select({ date: statementLines.date, ref: statementLines.ref, description: statementLines.description, debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor, inv: statementLines.matchedInvoiceId })
      .from(statementLines).where(eq(statementLines.statementId, id));
    if (lines.length === 0) continue;
    const r = await reconcileAndPersist({ statementId: id, supplierId: s.supplierId, supplierName: "", documentId: null, lines, openingMinor: s.ob, closingMinor: s.cb, actorId: null, persist: false });
    const mine = new Set(lines.map((l) => l.inv).filter(Boolean));
    const notIn = r.result.notInStatement.filter((i) => !mine.has(i.invoiceId));
    const open = and(eq(issues.entityType, "statement"), eq(issues.entityId, id), eq(issues.code, ISSUE.INVOICE_NOT_IN_STATEMENT), eq(issues.status, "OPEN"));
    await db.transaction(async (t) => {
      await t.delete(issues).where(open);
      if (notIn.length > 0) await t.insert(issues).values({ code: ISSUE.INVOICE_NOT_IN_STATEMENT, severity: "INFO", entityType: "statement", entityId: id,
        message: `${countNoun(notIn.length, INVOICE)} عندنا لم ترد في كشفه — تحقّق أنّها ليست مكرّرة أو لغير هذا المورّد` });
    });
  }
  const left = (await db.execute<{ name_ar: string; code: string; message: string }>(sql`
    select s.name_ar, i.code, i.message from issues i join statements st on st.id = i.entity_id join suppliers s on s.id = st.supplier_id
     where i.entity_type = 'statement' and i.status = 'OPEN' order by 1`)).rows;
  console.log("\nتنبيهاتُ الكشوف المفتوحة:");
  for (const o of left) console.log(`  ${o.name_ar} · ${o.code}: ${o.message}`);
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
