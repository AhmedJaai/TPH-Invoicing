/**
 * مطابقةُ كشف المورّد بفواتيرنا وحفظُ نتيجتها — موضعٌ واحد.
 *
 * كانت في مسار `statement-reconcile` وحده، فلم يكن لإصلاح أسطرٍ محفوظة (عمودُ الرصيد
 * الجاري قُرئ مديناً — أفال وأوراق الزيتون) طريقٌ إلّا قراءةٌ ثانية من الدرايف.
 * فالمسارُ والإصلاحُ يمرّان هنا: الفترةُ من الأسطر، ونافذةُ الفواتير، والمطابقة،
 * ثمّ الحفظ (الأسطر والفترة والرصيدان والتنبيهات) والسجلّ.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { invoices, issues, statementLines, statements } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { reconcileStatement, type OurInvoice, type StatementLineInput } from "@/lib/statement-match";

export interface ReconcileInput {
  statementId: string | null;
  supplierId: string;
  supplierName: string;
  documentId: string | null;
  lines: StatementLineInput[];
  /** `null` «لم يُقرأ» — لا صفر */
  openingMinor: number | null;
  closingMinor: number | null;
  actorId: string | null;
  /** يُحفظ أم يُعرض فقط (فحصٌ سريع بلا كشفٍ مؤرشف) */
  persist: boolean;
  /** سببٌ يُكتب في السجلّ مع النتيجة — للإصلاح */
  note?: string;
}

export async function reconcileAndPersist(input: ReconcileInput) {
  /*
   * الفترة تُؤخذ من سطور الكشف نفسها لا من حقل مسجَّل.
   *
   * درسٌ من أوّل مطابقة حقيقية: الترحيل استنتج فترة الكشف من تاريخ اسم الملف
   * فجعلها شهراً واحداً، وكشف أوراق الزيتون تراكميّ يغطّي أربعة أشهر. فقُوبلت
   * سطوره كلّها بفواتير شهر واحد، فظهرت ست وثلاثون فاتورة «ناقصة» وهي عندنا.
   * والكشف يغطّي ما تغطّيه سطوره، لا ما يقوله اسم ملفه.
   */
  const times = input.lines.map((l) => l.date.getTime());
  const start = new Date(Math.min(...times));
  const end = new Date(Math.max(...times));

  /*
   * نافذة الفواتير أوسع من مدى السطور بأسبوع من الطرفين.
   *
   * تاريخ المورّد للحركة ليس تاريخ فاتورتنا: رأينا سطراً بتاريخ ٢٣ أغسطس
   * يخصّ فاتورة عندنا بتاريخ ٢٦. فحصر النافذة في مدى السطور يُخفي الفاتورة
   * عن المطابقة، فتُعلَن «ناقصة» وهي عندنا — وإنذارٌ كاذب في هذا الموضع
   * يُفقد الميزة كلّها قيمتها.
   */
  const PAD_MS = 7 * 86_400_000;
  const ours: OurInvoice[] = await db
    .select({
      invoiceId: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      totalMinor: invoices.totalMinor,
    })
    .from(invoices)
    .where(and(
      eq(invoices.supplierId, input.supplierId),
      gte(invoices.invoiceDate, new Date(start.getTime() - PAD_MS)),
      lte(invoices.invoiceDate, new Date(end.getTime() + PAD_MS)),
    ));

  /*
    المجهولُ ليس صفراً — ولا هو مجموعَ الكشف: افتتاحيٌّ لم يُقرأ يُمرَّر غائباً،
    و`reconcileStatement` تُرجع «لم تُفحَص» لا «فُحصت فنجحت».
  */
  const result = reconcileStatement(input.lines, ours, {
    openingBalanceMinor: input.openingMinor ?? undefined,
    closingBalanceMinor: input.closingMinor ?? undefined,
  });
  const periodLabel = `${start.toISOString().slice(0, 10)} إلى ${end.toISOString().slice(0, 10)}`;

  if (!input.persist || !input.statementId) return { result, ours, start, end, periodLabel };
  const statementId = input.statementId;

  // ── الحفظ: سطور الكشف ونتيجته وتنبيهاته ──
  await db.transaction(async (tx) => {
    // تُعاد كتابة السطور كاملةً فتبقى إعادة المطابقة ممكنة بلا تكرار
    await tx.delete(statementLines).where(eq(statementLines.statementId, statementId));
    if (result.lines.length > 0) {
      await tx.insert(statementLines).values(result.lines.map((l) => ({
        statementId,
        date: l.line.date,
        ref: l.line.ref ?? null,
        description: l.line.description ?? null,
        debitMinor: l.line.debitMinor,
        creditMinor: l.line.creditMinor,
        matchedInvoiceId: l.invoice?.invoiceId ?? null,
        matchStatus:
          l.status === "MATCHED" ? "MATCHED" as const
          : l.status === "AMOUNT_MISMATCH" ? "DISPUTED" as const
          : l.status === "PAYMENT" ? "IGNORED" as const
          : "UNMATCHED" as const,
      })));
    }

    // الفترة المسجَّلة كانت مستنتَجة من اسم الملف؛ الآن نعرف ما تغطّيه سطوره
    await tx.update(statements).set({
      periodStart: start,
      periodEnd: end,
      /* العمودان يقبلان `null` منذ الهجرة ٠١٨ — فالمجهول يُحفَظ مجهولاً */
      openingBalanceMinor: input.openingMinor,
      closingBalanceMinor: input.closingMinor,
    }).where(eq(statements.id, statementId));

    /*
      التنبيهات تُستبدَل كما تُستبدَل الأسطر: كان «أعِد المطابقة» يُدرجها
      فوق السابقة، فتتضاعف في «يحتاج انتباهك» وفي موانع الإقفال مع كلّ ضغطة.
      والمحسومُ بيد إنسان يبقى — لا يُمحى قرارُه بإعادة حساب.
    */
    await tx.delete(issues).where(and(
      eq(issues.entityType, "statement"),
      eq(issues.entityId, statementId),
      eq(issues.status, "OPEN"),
    ));
    for (const f of result.findings) {
      await tx.insert(issues).values({
        code: f.code,
        severity: f.severity,
        entityType: "statement",
        entityId: statementId,
        message: f.message,
      });
    }

    await recordAudit({
      actorId: input.actorId,
      action: "STATEMENT_RECONCILED",
      entityType: "statement",
      entityId: statementId,
      after: {
        المورّد: input.supplierName,
        الفترة: periodLabel,
        سطور: input.lines.length,
        طوبقت: result.matchedCount,
        ناقصة_من_الأرشيف: result.missingFromArchive.length,
        فروق_مبالغ: result.amountMismatches.length,
        المستند: input.documentId,
        ...(input.note ? { السبب: input.note } : {}),
      },
    }, tx);
  });

  return { result, ours, start, end, periodLabel };
}
