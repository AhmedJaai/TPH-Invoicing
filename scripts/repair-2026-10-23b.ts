/**
 * كشفُ بيكوف (٢٥ سبتمبر) يعود إلى قراءته المستقيمة (٢٣ أكتوبر ٢٠٢٦، بقول أحمد: «قراءةٌ خاطئة لصيغة الكشف»).
 *
 * كان مطابَقاً سليماً منذ ٦ أكتوبر، ثمّ أُعيدت قراءتُه اليوم فأخذ النموذجُ عمودَ الرصيد مديناً ودائناً
 * وأسقط سطرين: صافي السطور ٦٬٠٥٠ والختاميّ ٦٨٠، وظهرت ١١ «فرقاً». وقراءتُه المخزّنة في مستنده
 * (`extraction_json`) تستقيم: ٠ + ٢٬٢٧٠ − ١٬٥٩٠ = ٦٨٠. فتُعاد السطورُ منها بالمسار نفسه الذي يقيّد به
 * الكشفُ (`parseStatementExtras` ثمّ `reconcileAndPersist`)، ولا تُكتب إلّا إن استقام حسابُها.
 * والحارسُ في `/api/statement-reconcile` يمنع أن تحلّ قراءةٌ لا تستقيم محلَّ مستقيمةٍ بعد اليوم.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-23b.ts [--i-know-this-is-production]
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { statementLines } from "@/db/schema";
import { parseStatementExtras, readingBalances } from "@/lib/extraction/statement-extras";
import { reconcileAndPersist, refreshStatementFindings } from "@/services/statement-reconcile.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const STATEMENT = "ae758a04-0f7b-41e4-8ebd-b65614fad29a";

async function main() {
  const [st] = (await db.execute<{ supplier_id: string; name: string; document_id: string; j: unknown; ob: number | null; cb: number | null }>(sql`
    select st.supplier_id, s.name_ar name, st.document_id, d.extraction_json j, st.opening_balance_minor ob, st.closing_balance_minor cb
      from statements st join suppliers s on s.id = st.supplier_id join documents d on d.id = st.document_id where st.id = ${STATEMENT}`)).rows;
  const stored = await db.select({ debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor }).from(statementLines).where(eq(statementLines.statementId, STATEMENT));
  const x = parseStatementExtras(st.j);
  console.log(`المحفوظ: ${stored.length} سطراً · يستقيم؟ ${readingBalances(stored, st.ob, st.cb)}`);
  console.log(`من القراءة المخزّنة: ${x.lines.length} سطراً · يستقيم؟ ${readingBalances(x.lines, x.openingBalanceMinor, x.closingBalanceMinor)}`);
  if (readingBalances(stored, st.ob, st.cb) === true) { console.log("المحفوظ مستقيم — لا شيء."); process.exit(0); }
  if (readingBalances(x.lines, x.openingBalanceMinor, x.closingBalanceMinor) !== true) { console.log("✕ القراءة المخزّنة لا تستقيم كذلك — لا تُكتب."); process.exit(1); }
  const r = await reconcileAndPersist({
    statementId: STATEMENT, supplierId: st.supplier_id, supplierName: st.name, documentId: st.document_id,
    lines: x.lines, openingMinor: x.openingBalanceMinor, closingMinor: x.closingBalanceMinor, actorId: AHMED, persist: WRITE,
    note: "أُعيدت السطور من القراءة المخزّنة المستقيمة بعد إعادة قراءةٍ أخذت عمود الرصيد مبلغاً — بقول أحمد (٢٣ أكتوبر ٢٠٢٦)، نفّذه Claude",
  });
  if (WRITE) await db.transaction((t) => refreshStatementFindings(t, STATEMENT));
  console.log(`${WRITE ? "كُتب" : "معاينة"}: طوبق ${r.result.matchedCount}/${x.lines.length} · فروق مبالغ ${r.result.amountMismatches.length} · ليست عندنا ${r.result.missingFromArchive.length} · عندنا وليست فيه ${r.result.notInStatement.length} · الحساب يستقيم ${r.result.balanceArithmeticOk}`);
  process.exit(0);
}
main().catch((e) => { console.error("✕", e); process.exit(1); });
