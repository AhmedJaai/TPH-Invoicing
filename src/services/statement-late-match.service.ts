/**
 * فاتورةٌ تصل بعد كشف مورّدها — تُطابَق بسطرها فيه وحدها.
 *
 * الكشفُ يُطابَق حين يُقرأ، وما لم يجد فاتورتَه يُقال «في كشف المورّد ولا ملفَّ
 * لها عندنا — اطلبها منه». فإذا وصلت بعده بقي السطرُ «غير مطابَق» والتنبيهُ
 * مفتوحاً يطلب ما وصل، إلى أن يضغط أحدٌ «أعِد المطابقة» (وهي تقرأ الملفَّ ثانيةً).
 *
 * فيُسأل عند إنشاء كلّ فاتورة: أفي كشوف مورّدها سطرٌ ينتظرها؟ بالنواة نفسها
 * (`reconcileStatement`) — الرقمُ أو المبلغُ والتاريخ — ثمّ يُعاد عدُّ ما بقي
 * في الكشف: يُحدَّث التنبيهُ بعدده، أو يُحسَم إن لم يبق شيء.
 */
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { issues, statementLines, statements } from "@/db/schema";
import { reconcileStatement, type StatementLineInput } from "@/lib/statement-match";
import { ISSUE } from "@/lib/issue-codes";
import { formatRiyalsDisplay } from "@/lib/money";
import { INVOICE, countNoun } from "@/lib/arabic";
import type { Tx } from "./types";

export async function matchLateInvoice(
  tx: Tx,
  invoice: { id: string; supplierId: string; invoiceNumber: string; invoiceDate: Date; totalMinor: number },
): Promise<number> {
  /* الفاتورةُ سطرٌ واحد في كشوف مورّدها — فإن طوبقت بسطرٍ فلا تُطابَق بثانٍ (غاناش) */
  const [already] = await tx.select({ id: statementLines.id }).from(statementLines)
    .where(eq(statementLines.matchedInvoiceId, invoice.id)).limit(1);
  if (already) return 0;

  const waiting = await tx
    .select({
      id: statementLines.id, statementId: statementLines.statementId, date: statementLines.date,
      ref: statementLines.ref, description: statementLines.description, debitMinor: statementLines.debitMinor,
    })
    .from(statementLines)
    .innerJoin(statements, eq(statements.id, statementLines.statementId))
    .where(and(
      eq(statements.supplierId, invoice.supplierId),
      eq(statementLines.matchStatus, "UNMATCHED"),
      isNull(statementLines.matchedInvoiceId),
      gt(statementLines.debitMinor, 0),
    ));
  if (waiting.length === 0) return 0;

  const inputs: StatementLineInput[] = waiting.map((w) => ({ date: w.date, ref: w.ref, description: w.description, debitMinor: w.debitMinor, creditMinor: 0 }));
  const result = reconcileStatement(inputs, [{
    invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, totalMinor: invoice.totalMinor,
  }]);
  const hit = result.lines.find((l) => l.status === "MATCHED" && l.invoice?.invoiceId === invoice.id);
  if (!hit) return 0;
  const line = waiting[inputs.indexOf(hit.line)];
  if (!line) return 0;

  await tx.update(statementLines)
    .set({ matchedInvoiceId: invoice.id, matchStatus: "MATCHED" })
    .where(and(eq(statementLines.id, line.id), isNull(statementLines.matchedInvoiceId)));

  /* التنبيهُ يقول ما بقي — أو يُحسَم */
  const [left] = (await tx.execute<{ n: number; total: number }>(sql`
    select count(*)::int as n, coalesce(sum(debit_minor), 0)::bigint as total
      from statement_lines
     where statement_id = ${line.statementId} and match_status = 'UNMATCHED' and debit_minor > 0
  `)).rows;
  const open = and(
    eq(issues.entityType, "statement"),
    eq(issues.entityId, line.statementId),
    eq(issues.code, ISSUE.INVOICE_IN_STATEMENT_NOT_ARCHIVED),
    eq(issues.status, "OPEN"),
  );
  if (Number(left.n) === 0) {
    await tx.update(issues).set({ status: "RESOLVED", resolvedAt: new Date() }).where(open);
  } else {
    await tx.update(issues).set({
      message: `${countNoun(Number(left.n), INVOICE)} في كشف المورّد بقيمة ${formatRiyalsDisplay(Number(left.total))} ريال ولا ملف لها عندنا — اطلبها منه`,
    }).where(open);
  }
  return 1;
}

