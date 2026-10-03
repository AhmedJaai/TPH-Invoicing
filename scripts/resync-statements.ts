/**
 * يعيد مطابقةَ كشوف مورّدٍ من أسطرها المحفوظة بالقواعد الحاليّة — بعد أن تتحسّن القواعد.
 *
 *   npx tsx --env-file=.env scripts/resync-statements.ts <slug>                 معاينة لا تكتب
 *   npx tsx --env-file=.env scripts/resync-statements.ts <slug> --i-know-this-is-production
 *   (و`all` لكلّ المورّدين)
 *
 * لوريفا (٣ أكتوبر ٢٠٢٦): كشفُه يكتب المبلغ قبل الضريبة، فبقي في صفحة الكشوف «١٣ فاتورة
 * يخالف مبلغها» و«SI-0059 لا ملفَّ لها» بعد أن صار `amountAgrees` و`unreverseInvoiceNumber`
 * يعرفانها. وما طابقه القيدُ من الكشف (فاتورةٌ جامعة) لا يُعاد: الكشفُ الذي فيه سطرٌ مطابَقٌ
 * بغير رقمه يُترك ويُقال.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, statementLines, statements, suppliers } from "@/db/schema";
import { reconcileAndPersist, refreshStatementFindings } from "@/services/statement-reconcile.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";

async function main() {
  const slug = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!slug) throw new Error("اسمُ المورّد في الأرشيف مطلوب (slug)");
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");
  const sts = await db.select({ id: statements.id, supplierId: statements.supplierId, documentId: statements.documentId, ob: statements.openingBalanceMinor, cb: statements.closingBalanceMinor, name: suppliers.nameAr, file: documents.fileName })
    .from(statements).innerJoin(suppliers, eq(suppliers.id, statements.supplierId)).innerJoin(documents, eq(documents.id, statements.documentId))
    .where(slug === "all" ? undefined : eq(suppliers.slug, slug)).orderBy(suppliers.nameAr, statements.periodEnd);
  for (const st of sts) {
    const [{ combined }] = (await db.execute<{ combined: number }>(sql`
      select count(*)::int combined from statement_lines sl join documents d on d.origin_statement_id = sl.statement_id
       where sl.statement_id = ${st.id}`)).rows;
    if (Number(combined) > 0) { console.log(`${st.file}: فيه ما قُيِّد من الكشف — يُترك`); continue; }
    const lines = await db.select({ date: statementLines.date, ref: statementLines.ref, description: statementLines.description, debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor })
      .from(statementLines).where(eq(statementLines.statementId, st.id)).orderBy(statementLines.date, statementLines.id);
    if (lines.length === 0) continue;
    const r = await reconcileAndPersist({ statementId: st.id, supplierId: st.supplierId, supplierName: st.name, documentId: st.documentId,
      lines, openingMinor: st.ob, closingMinor: st.cb, actorId: AHMED, persist: WRITE, note: "إعادةُ المطابقة بالقواعد الحاليّة — بإذن أحمد (٣ أكتوبر ٢٠٢٦)" });
    if (WRITE) await db.transaction((t) => refreshStatementFindings(t, st.id));
    console.log(`${st.file}: طوبق ${r.result.matchedCount}/${lines.length} · فروق ${r.result.amountMismatches.length} · ليست عندنا ${r.result.missingFromArchive.length} · عندنا وليست فيه ${r.result.notInStatement.length}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
