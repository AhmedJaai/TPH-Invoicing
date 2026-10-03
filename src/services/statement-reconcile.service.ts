/**
 * مطابقةُ كشف المورّد بفواتيرنا وحفظُ نتيجتها — موضعٌ واحد.
 *
 * كانت في مسار `statement-reconcile` وحده، فلم يكن لإصلاح أسطرٍ محفوظة (عمودُ الرصيد
 * الجاري قُرئ مديناً — أفال وأوراق الزيتون) طريقٌ إلّا قراءةٌ ثانية من الدرايف.
 * فالمسارُ والإصلاحُ يمرّان هنا: الفترةُ من الأسطر، ونافذةُ الفواتير، والمطابقة،
 * ثمّ الحفظ (الأسطر والفترة والرصيدان والتنبيهات) والسجلّ.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { INVOICE, countNoun } from "@/lib/arabic";
import { ISSUE } from "@/lib/issue-codes";
import { db } from "@/db";
import { invoices, issues, statementLines, statements } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { TOTAL_ROUNDING_TOLERANCE_MINOR, formatRiyalsDisplay } from "@/lib/money";
import { reconcileStatement, type OurInvoice, type StatementLineInput } from "@/lib/statement-match";
import type { Conn, Tx } from "./types";

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

  /*
    ── كشفُه مقابلَ دفترنا ──
    الفحوصُ السابقة تقابل سطراً بسطر، ولا تقول إنّ ما يطالبنا به المورّدُ غيرُ ما ندين له به.
    فغاناش: كشفُ أغسطس يقول ٥٬٤٣٢٫٦٠ ودفترُنا يقول «لنا عنده ٢٠٬٤٢٤» — ولم ينبّه شيء.
    والمقارنةُ يومَ آخر سطر: فواتيرُه حتى يومها ناقصَ سدادِنا قبلها (سدادُ اليوم نفسه بعد
    إصدار الكشف غالباً — أفال ٢٧ سبتمبر).
  */
  if (input.closingMinor !== null) {
    const matched = result.lines.flatMap((l) => (l.status === "MATCHED" && l.invoice ? [{ invoiceId: l.invoice.invoiceId, debitMinor: l.line.debitMinor }] : []));
    const creditOnEnd = input.lines.some((l) => l.creditMinor > 0 && l.date.getTime() === end.getTime());
    const gap = await ledgerGapFinding(db, input.supplierId, end, input.closingMinor, matched, creditOnEnd);
    if (gap) result.findings.push(gap);
  }

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

/*
  ── كشفُه مقابلَ دفترنا ──
  الفحوصُ السابقة تقابل سطراً بسطر، ولا تقول إنّ ما يطالبنا به المورّدُ غيرُ ما ندين له به.
  فغاناش: كشفُ أغسطس يقول ٥٬٤٣٢٫٦٠ ودفترُنا يقول «لنا عنده ٢٠٬٤٢٤» — ولم ينبّه شيء.
  والمقارنةُ يومَ آخر سطر: فواتيرُه حتى يومها ناقصَ سدادِنا قبلها (سدادُ اليوم نفسه بعد
  إصدار الكشف غالباً — أفال ٢٧ سبتمبر).
*/
/*
  وفاتورةٌ طابقت سطراً من الكشف تُحسب **بسطرها** أيّاً كان تاريخُها: أفال يذكر التسليمَ
  S00124 يوم ٢٣ أغسطس وفاتورتُه عندنا بتاريخ ٢٧، فكان الفحصُ بالتاريخ وحده يقول
  «ينقصنا ١٬٩٤٤٫٩٤» عن فاتورةٍ عندنا ومطابَقة. وفاتورةُ هنقري مان الجامعة تُحسب بأسطرها
  التي في هذا الكشف لا بمجموعها كلّه.
*/
async function ledgerGapFinding(
  conn: Conn, supplierId: string, end: Date, closingMinor: number,
  matched: readonly { invoiceId: string; debitMinor: number }[],
  /* الكشفُ نفسُه يذكر سداداً في آخر أيّامه (هنقري مان ٥ يونيو) — فسدادُ ذلك اليوم داخلٌ فيه */
  creditOnEnd: boolean,
) {
  const day = end.toISOString().slice(0, 10);
  const ids = [...new Set(matched.map((m) => m.invoiceId))];
  const onLines = matched.reduce((s, m) => s + m.debitMinor, 0);
  const notMatched = ids.length > 0 ? sql`and i.id not in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const [ledger] = (await conn.execute<{ owed: string | number }>(sql`
    select (
      (select coalesce(sum(i.total_minor), 0) from invoices i join documents d on d.id = i.document_id
        where i.supplier_id = ${supplierId} and i.invoice_date::date <= ${day}::date and d.status <> 'REJECTED' ${notMatched})
      - (select coalesce(sum(p.amount_minor - p.fee_minor), 0) from payments p
        where p.supplier_id = ${supplierId} and p.status not in ('VOID', 'REVERSED')
          and ${creditOnEnd ? sql`p.paid_at::date <= ${day}::date` : sql`p.paid_at::date < ${day}::date`})
    )::bigint as owed`)).rows;
  const owed = Number(ledger?.owed ?? 0) + onLines;
  const gap = owed - closingMinor;
  if (Math.abs(gap) <= TOTAL_ROUNDING_TOLERANCE_MINOR) return null;
  return {
    owedMinor: owed,
    gapMinor: gap,
    code: ISSUE.STATEMENT_LEDGER_GAP,
    severity: "WARN" as const,
    message: `كشفُه يقول إنّا ندين له ${formatRiyalsDisplay(closingMinor)} يوم ${day}، ودفترُنا يقول ${owed >= 0 ? formatRiyalsDisplay(owed) : `لنا عنده ${formatRiyalsDisplay(-owed)}`} — `
      + (gap < 0 ? `ينقصنا ${formatRiyalsDisplay(-gap)}: فواتيرُ في كشفه لم تُقيَّد، أو سدادٌ مقيَّدٌ لم يقع` : `يزيدنا ${formatRiyalsDisplay(gap)}: سدادٌ لم يُقيَّد، أو فاتورةٌ عندنا ليست في كشفه`),
  };
}

/**
 * تنبيهاتُ الكشف بعد أن تغيّر ما حوله — لا بعد قراءته وحدها.
 *
 * «قيّدها من الكشف» كان يقيّد فواتيرَه ويترك تنبيهَيه كما كُتبا قبلها: «ينقصنا ٥٬٢٢٥٫٦٠»
 * و«٨ فواتير لا ملفَّ لها» عن كشفٍ صار مطابِقاً لدفترنا (إصلاح ٣ أكتوبر). فيُعاد هنا
 * حسابُ الاثنين من القاعدة: ما بقي من أسطره بلا فاتورة، وما بين ختاميّه ودفترنا —
 * ويُحدَّث التنبيه أو يُحسَم. والمحسومُ بيد إنسانٍ لا يُمسّ.
 */
export async function refreshStatementFindings(tx: Tx, statementId: string): Promise<void> {
  const [st] = await tx.select({ supplierId: statements.supplierId, end: statements.periodEnd, closing: statements.closingBalanceMinor })
    .from(statements).where(eq(statements.id, statementId)).limit(1);
  if (!st) return;
  const open = (code: string) => and(eq(issues.entityType, "statement"), eq(issues.entityId, statementId), eq(issues.code, code), eq(issues.status, "OPEN"));
  const put = async (code: string, finding: { severity: "WARN"; message: string } | null) => {
    const [cur] = await tx.select({ id: issues.id }).from(issues).where(open(code)).limit(1);
    if (!finding) {
      if (cur) await tx.update(issues).set({ status: "RESOLVED", resolvedAt: new Date() }).where(open(code));
    } else if (cur) {
      await tx.update(issues).set({ message: finding.message }).where(eq(issues.id, cur.id));
    } else {
      await tx.insert(issues).values({ code, severity: finding.severity, entityType: "statement", entityId: statementId, message: finding.message });
    }
  };

  const [left] = (await tx.execute<{ n: number; total: number }>(sql`
    select count(*)::int as n, coalesce(sum(debit_minor), 0)::bigint as total
      from statement_lines
     where statement_id = ${statementId} and match_status = 'UNMATCHED' and debit_minor > 0
  `)).rows;
  await put(ISSUE.INVOICE_IN_STATEMENT_NOT_ARCHIVED, Number(left.n) === 0 ? null : {
    severity: "WARN",
    message: `${countNoun(Number(left.n), INVOICE)} في كشف المورّد بقيمة ${formatRiyalsDisplay(Number(left.total))} ريال ولا ملف لها عندنا — اطلبها منه`,
  });
  if (st.closing !== null && st.end) {
    await put(ISSUE.STATEMENT_LEDGER_GAP, await storedLedgerGap(tx, statementId, st.supplierId, st.end, st.closing));
  }
}

async function storedLedgerGap(conn: Conn, statementId: string, supplierId: string, end: Date, closingMinor: number) {
  const rows = await conn.select({ invoiceId: statementLines.matchedInvoiceId, debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor, date: statementLines.date, status: statementLines.matchStatus })
    .from(statementLines).where(eq(statementLines.statementId, statementId));
  return ledgerGapFinding(conn, supplierId, end, closingMinor,
    rows.flatMap((m) => (m.status === "MATCHED" && m.invoiceId ? [{ invoiceId: m.invoiceId, debitMinor: m.debitMinor }] : [])),
    rows.some((m) => m.creditMinor > 0 && m.date.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)));
}

export interface SupplierLedgerGap {
  supplierName: string;
  slug: string;
  day: string;
  theirsMinor: number;
  oursMinor: number;
  gapMinor: number;
}

/**
 * كلُّ مورّدٍ مقابلَ آخر كشفه — لـ«يحتاج قرارك».
 *
 * كان الفرقُ يُكتب تنبيهاً على الكشف ولا يبلغ الصفحةَ التي يُسأل منها «ماذا أفعل اليوم؟»:
 * غاناش ينقصه ٦٤٨٫٦٠ (فواتيرُ ٢٩–٣١ يوليو) ولا يراه إلّا من فتح صفحة الكشوف. فيُحسب هنا
 * لآخر كشفٍ لكلّ مورّد — بالقاعدة نفسها التي تكتب التنبيه — وما قبله نسخَه آخرُه.
 */
export async function latestStatementGaps(conn: Conn = db): Promise<SupplierLedgerGap[]> {
  const latest = (await conn.execute<{ id: string; supplier_id: string; name_ar: string; slug: string; pe: string; cb: number }>(sql`
    select distinct on (st.supplier_id) st.id, st.supplier_id, s.name_ar, s.slug, st.period_end as pe, st.closing_balance_minor as cb
      from statements st join suppliers s on s.id = st.supplier_id
     where st.closing_balance_minor is not null and st.period_end is not null
       and exists (select 1 from statement_lines sl where sl.statement_id = st.id)
     order by st.supplier_id, st.period_end desc`)).rows;
  const out: SupplierLedgerGap[] = [];
  for (const l of latest) {
    const end = new Date(l.pe);
    const f = await storedLedgerGap(conn, l.id, l.supplier_id, end, Number(l.cb));
    if (f) out.push({ supplierName: l.name_ar, slug: l.slug, day: end.toISOString().slice(0, 10), theirsMinor: Number(l.cb), oursMinor: f.owedMinor, gapMinor: f.gapMinor });
  }
  return out.sort((a, b) => Math.abs(b.gapMinor) - Math.abs(a.gapMinor));
}
