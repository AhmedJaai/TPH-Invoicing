/**
 * «قيّد الناقصة من الكشف» — فواتيرُ يذكرها كشفُ المورّد ولا ملفَّ لها عندنا.
 *
 * غاناش (الإنتاج): كشوفُ مايو–أغسطس تذكر ٣٨ فاتورة لا ملفَّ لها، فبقيت خارج المستحقّ
 * والمشتريات، وحوالتُه الشهريّة — مجموعُ كلّ كشف — بدت سداداً زائداً بعشرين ألفاً. وكان
 * التنبيهُ يقول «اطلبها منه» والرصيدُ يقول «لنا عنده ٢٠٬٤٢٤».
 *
 * فيُقرّ إنسانٌ أنّ كشفَ المورّد دليلُ الدَّين، فيُقيَّد لكلّ سطرٍ مدينٍ لم يُطابَق:
 * - مستندٌ بلا ملفّ أصلُه الكشف (`origin = STATEMENT_LINE`، 057) وفاتورتُه بالرقم واليوم
 *   والمبلغ كما في السطر — والصافي والضريبة **غير معروفين** لا صفر، فلا تُخصم ضريبتُها.
 * - ويُطابَق السطرُ بها، ثمّ يُوزَّع رصيدُ المورّد بالأقدم أوّلاً.
 * - وما كان رقمُه عندنا (بأيّ صيغة) لا يُقيَّد ثانية؛ وسطرٌ في شهرٍ مقفل يُترك ويُقال.
 * - وحين يصل ملفُّ الفاتورة يتبنّاها `createInvoice` ولا تُكرَّر.
 */
import { and, eq, gt, isNotNull } from "drizzle-orm";
import { documents, invoices, statementLines, statements, suppliers } from "@/db/schema";
import { reviewConfirmed } from "@/lib/confirm";
import { companyConfig } from "@/config/drive";
import { recordAudit } from "@/lib/audit";
import { formatRiyalsDisplay } from "@/lib/money";
import { invoiceNumberKey } from "@/lib/invoice-twin";
import { monthOf } from "@/lib/filing";
import { createInvoice, STATEMENT_LINE_ORIGIN } from "./invoice.service";
import { applySupplierCredit } from "./supplier-credit.service";
import { firstClosedMonth } from "./month-guard";
import { refreshStatementFindings } from "./statement-reconcile.service";
import type { Tx } from "./types";

export class StatementInvoicesRefused extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "StatementInvoicesRefused";
  }
}

/** «INVA/2026/02717 (Abhur - 001578» ← «INVA/2026/02717»: ما بعد القوس وصفُ فرعٍ لا رقم. */
export function statementRefNumber(ref: string): string {
  return ref.split(" (")[0].trim();
}

export interface StatementInvoicesOutcome {
  created: { number: string; date: string; amountMinor: number }[];
  /** رقمُه عندنا من قبل — طوبق أو سيُطابَق، لا يُقيَّد ثانية */
  alreadyRecorded: number;
  /** في شهرٍ مقفل — يُفتح أوّلاً */
  closedMonth: { number: string; month: string }[];
}

export async function recordStatementOnlyInvoices(
  tx: Tx,
  statementId: string,
  actorId: string,
): Promise<StatementInvoicesOutcome> {
  const [st] = await tx
    .select({ id: statements.id, supplierId: statements.supplierId, fileName: documents.fileName, slug: suppliers.slug })
    .from(statements)
    .innerJoin(documents, eq(documents.id, statements.documentId))
    .innerJoin(suppliers, eq(suppliers.id, statements.supplierId))
    .where(eq(statements.id, statementId))
    .for("update", { of: statements })
    .limit(1);
  if (!st) throw new StatementInvoicesRefused("لا كشف بهذا المعرّف", 404);

  const lines = await tx
    .select({ id: statementLines.id, date: statementLines.date, ref: statementLines.ref, debitMinor: statementLines.debitMinor })
    .from(statementLines)
    .where(and(
      eq(statementLines.statementId, statementId),
      eq(statementLines.matchStatus, "UNMATCHED"),
      gt(statementLines.debitMinor, 0),
      isNotNull(statementLines.ref),
    ))
    .orderBy(statementLines.date);
  if (lines.length === 0) return { created: [], alreadyRecorded: 0, closedMonth: [] };

  const ours = await tx.select({ id: invoices.id, n: invoices.invoiceNumber, date: invoices.invoiceDate, total: invoices.totalMinor })
    .from(invoices).where(eq(invoices.supplierId, st.supplierId));
  const known = new Set(ours.map((r) => invoiceNumberKey(r.n ?? "")));

  /*
    ── أمراجعُ هذا الكشف أرقامُ فواتيرنا؟ ──
    جُرّب على نسخةٍ من الإنتاج فقُيّدت ٩ فواتير لزاكوباك و٥ لأفال **مكرَّرة**: مرجعُ كشفيهما
    ترقيمُ المورّد (طلبٌ أو تسليم) لا رقمُ الفاتورة، والفاتورةُ عندنا برقمٍ آخر. فلا يُقيَّد من
    كشفٍ إلّا وقد ثبت أنّ مراجعه أرقامُ فواتير: سطرٌ فيه طوبق برقمه، أو لا فاتورةَ لنا من
    المورّد في مدّة الكشف أصلاً (غاناش يونيو).
  */
  const span = lines.map((l) => l.date.getTime());
  const from = Math.min(...span) - 7 * 86_400_000;
  const to = Math.max(...span) + 7 * 86_400_000;
  /* فاتورةٌ عندنا في المدّة لم يطابقها سطرٌ من أيّ كشف — قد تكون أصلَ سطرٍ بترقيمٍ آخر */
  const matchedAnywhere = new Set((await tx.select({ id: statementLines.matchedInvoiceId }).from(statementLines)
    .innerJoin(statements, eq(statements.id, statementLines.statementId))
    .where(and(eq(statements.supplierId, st.supplierId), isNotNull(statementLines.matchedInvoiceId)))).map((r) => r.id));
  const inWindow = ours.filter((o) => o.date.getTime() >= from && o.date.getTime() <= to && !matchedAnywhere.has(o.id));
  const matchedByNumber = (await tx
    .select({ ref: statementLines.ref, n: invoices.invoiceNumber })
    .from(statementLines)
    .innerJoin(invoices, eq(invoices.id, statementLines.matchedInvoiceId))
    .where(and(eq(statementLines.statementId, statementId), isNotNull(statementLines.ref))))
    .some((m) => {
      const a = invoiceNumberKey(statementRefNumber(m.ref ?? "")); const b = invoiceNumberKey(m.n ?? "");
      return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
    });
  if (!matchedByNumber && inWindow.length > 0) {
    throw new StatementInvoicesRefused(
      "مراجعُ هذا الكشف ليست أرقامَ فواتيرنا (لم يطابق سطرٌ منه فاتورةً برقمها) — فلا يُقيَّد منه شيءٌ آلياً، "
      + "وقد تكون فواتيرُه عندنا بأرقامٍ أخرى. قارِنه بالفواتير من صفحة المورّد.",
    );
  }

  const out: StatementInvoicesOutcome = { created: [], alreadyRecorded: 0, closedMonth: [] };
  for (const l of lines) {
    const number = statementRefNumber(l.ref!);
    const key = invoiceNumberKey(number);
    if (!key || known.has(key)) { out.alreadyRecorded++; continue; }
    /*
      رقمٌ داخل رقم فاتورةٍ جامعة — هنقري مان: «INVA-02527-02717-02751-02781» عندنا، وفي
      كشفه «INVA/2026/02717»: لا يحتوي أحدُهما الآخرَ حرفاً، ويجمعهما المقطعُ «02717».
    */
    const tail = digitTail(number);
    const combined = tail ? ours.find((o) => digitGroups(o.n ?? "").includes(tail) && invoiceNumberKey(o.n ?? "") !== key) : undefined;
    if (combined) {
      /* السطرُ جزءٌ منها — يُطابَق بها فلا يبقى «لا ملفَّ له» وزرُّه يعود بلا شيء */
      await tx.update(statementLines).set({ matchedInvoiceId: combined.id, matchStatus: "MATCHED" }).where(eq(statementLines.id, l.id));
      out.alreadyRecorded++;
      continue;
    }
    /* فاتورةٌ عندنا باليوم والمبلغ نفسيهما لم يطابقها سطر — قد تكون هي برقمٍ آخر: لا يُخمَّن */
    const sameDayAmount = ours.some((o) => o.total === l.debitMinor && Math.abs(o.date.getTime() - l.date.getTime()) <= 3 * 86_400_000);
    if (sameDayAmount && !matchedByNumber) { out.alreadyRecorded++; continue; }
    const month = monthOf(l.date);
    if (await firstClosedMonth(tx, [month])) { out.closedMonth.push({ number, month }); continue; }

    const [doc] = await tx.insert(documents).values({
      fileName: `${st.slug}_${number} — من كشف ${st.fileName}`,
      mimeType: "application/vnd.tph.statement-line",
      kind: "TAX_INVOICE",
      status: "ARCHIVED",
      periodMonth: month,
      supplierId: st.supplierId,
      uploadedById: actorId,
      origin: STATEMENT_LINE_ORIGIN,
      originStatementId: st.id,
    }).returning({ id: documents.id });

    const day = l.date.toISOString().slice(0, 10);
    const review = reviewConfirmed(
      { documentKind: "TAX_INVOICE", supplierId: st.supplierId, invoiceNumber: number, invoiceDate: day,
        subtotalMinor: null, vatMinor: null, totalMinor: l.debitMinor, sellerVat: null, buyerVat: null },
      { companyVat: companyConfig.vatNumber },
    );
    const invoiceId = await createInvoice(tx, {
      documentId: doc.id, supplierId: st.supplierId, invoiceNumber: number, invoiceDate: l.date, periodMonth: month,
      subtotalMinor: null, vatMinor: null, totalMinor: l.debitMinor,
      taxStatus: review.taxStatus, inputVatStatus: review.inputVatStatus, isFixedAsset: review.isFixedAsset,
    });
    if (!invoiceId) { out.alreadyRecorded++; continue; }
    await tx.update(statementLines).set({ matchedInvoiceId: invoiceId, matchStatus: "MATCHED" }).where(eq(statementLines.id, l.id));
    known.add(key);
    out.created.push({ number, date: day, amountMinor: l.debitMinor });
  }

  /* ما بقي بلا فاتورة، وما بين ختاميّه ودفترنا — بعد القيد لا قبله */
  if (out.created.length > 0 || out.alreadyRecorded > 0) await refreshStatementFindings(tx, st.id);

  if (out.created.length > 0) {
    /* قرارُ إنسان: الرصيدُ يُوزَّع بالأقدم أوّلاً بلا نافذة */
    await applySupplierCredit(tx, st.supplierId, { forwardDays: null });
    await recordAudit({
      actorId,
      action: "STATEMENT_INVOICES_RECORDED",
      entityType: "statement",
      entityId: st.id,
      after: {
        الكشف: st.fileName,
        الفواتير: out.created.map((c) => `${c.number} · ${c.date} · ${formatRiyalsDisplay(c.amountMinor)}`),
        السبب: "فواتيرُ يذكرها كشفُ المورّد ولا ملفَّ لها — قُيِّدت منه، ولا تُخصم ضريبتُها حتى يصل ملفُّها",
        شهرٌ_مقفل: out.closedMonth.map((c) => `${c.number} (${c.month})`),
      },
    }, tx);
  }
  return out;
}


/** المقاطعُ الرقميّة المميِّزة (٤ خاناتٍ فأكثر) — «INVA-02527-02717» ← [02527, 02717] */
function digitGroups(n: string): string[] {
  return n.match(/\d{4,}/g) ?? [];
}

/** آخرُ مقطعٍ رقميٍّ مميِّز — السنةُ وحدها («2026») لا تميّز فاتورة */
function digitTail(n: string): string | null {
  const groups = digitGroups(n).filter((g) => !/^20\d\d$/.test(g));
  return groups.length > 0 ? groups[groups.length - 1] : null;
}
