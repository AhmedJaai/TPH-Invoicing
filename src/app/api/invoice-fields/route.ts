/**
 * تصحيحُ حقول فاتورةٍ مقيَّدة بيد الإنسان.
 *
 * ── لماذا وُجد هذا المسار ──
 *
 * كانت الشاشة تقول «لا يوجد رقم فاتورة» — **والرقمُ على الورقة**، لم
 * يقرأه النموذج. فيقف صاحب المقهى أمام فاتورةٍ يعرف رقمَها ولا يملك
 * موضعاً يكتبه فيه: لا اعتمادٌ ينفع (الفاتورة ستبقى ناقصة)، ولا رفضٌ
 * يصحّ (الفاتورة سليمة). طريقٌ مسدود.
 *
 * والقراءةُ الآليّة تُخطئ — وهذا معروفٌ ومعلَن في هذا المشروع. فالعلاجُ
 * أن يُصحَّح ما أخطأت فيه، لا أن يُرفَض المستند الصحيح.
 *
 * ── وما الذي يُحرَس ──
 *
 *   • **حالُ الضريبة تُعاد اشتقاقها** من الحقول الجديدة بـ`reviewConfirmed`
 *     — ولا تُؤخَذ من المتصفّح. وهو قيدُ «الخادم لا يثق بالمتصفّح»
 *     نفسُه: من يصحّح رقماً لا يقرّر معه أنّ الفاتورة صارت صالحة.
 *   • **الشهر المقفل يمنع** — الفاتورة في شهرٍ أُقفل لا تُمَسّ.
 *   • **الإجماليّ لا يُنقَص دون ما خُصّص عليه** — وإلّا صارت الفاتورة
 *     مسدَّدةً فوق قيمتها، وذلك يكسر ثابتاً في القاعدة.
 *   • **كلُّ تغييرٍ في سجلّ التدقيق** بقيمته قبلَه وبعدَه.
 */
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, suppliers } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { reviewConfirmed } from "@/lib/confirm";
import { companyConfig } from "@/config/drive";
import { assertMonthsOpen } from "@/services/month-guard";
import { formatRiyalsDisplay, parseRiyals } from "@/lib/money";

export const runtime = "nodejs";

interface Body {
  invoiceId?: string;
  invoiceNumber?: string | null;
  sellerVat?: string | null;
  buyerVat?: string | null;
  /** نصٌّ كما يكتبه الإنسان: «١٬٢٣٤٫٥٦» أو «1234.56» */
  subtotal?: string | null;
  vat?: string | null;
  total?: string | null;
}

/**
 * غيابُ المفتاح يعني «اتركه كما هو»، والفراغُ يعني «امحُه».
 *
 * والفرقُ بينهما مقصود: طلبٌ يحمل حقلاً واحداً لا يمحو ما لم يذكره.
 */
function textField(v: string | null | undefined, current: string | null): string | null {
  if (v === undefined) return current;
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function amountField(v: string | null | undefined, current: number | null): number | null {
  if (v === undefined) return current;
  if (v === null || v.trim() === "") return null;
  /* ما لا يُقرأ رقماً يُترَك على حاله ولا يُكتَب صفراً */
  return parseRiyals(v) ?? current;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("invoice-fields", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }

  const id = body.invoiceId?.trim();
  if (!id) return NextResponse.json({ error: "لم تُذكر الفاتورة" }, { status: 400 });

  const [row] = await db
    .select({
      id: invoices.id,
      documentKind: documents.kind,
      periodMonth: invoices.periodMonth,
      invoiceNumber: invoices.invoiceNumber,
      sellerVat: invoices.sellerVat,
      buyerVat: invoices.buyerVat,
      subtotalMinor: invoices.subtotalMinor,
      vatMinor: invoices.vatMinor,
      totalMinor: invoices.totalMinor,
      invoiceDate: invoices.invoiceDate,
      supplierId: invoices.supplierId,
      allocated: sql<number>`coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0)`,
    })
    .from(invoices)
    .leftJoin(documents, eq(documents.id, invoices.documentId))
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "لا فاتورة بهذا المعرّف" }, { status: 404 });

  const next = {
    invoiceNumber: textField(body.invoiceNumber, row.invoiceNumber),
    sellerVat: textField(body.sellerVat, row.sellerVat),
    buyerVat: textField(body.buyerVat, row.buyerVat),
    subtotalMinor: amountField(body.subtotal, row.subtotalMinor),
    vatMinor: amountField(body.vat, row.vatMinor),
    totalMinor: amountField(body.total, row.totalMinor),
  };

  /*
    رقمُ الفاتورة عمودٌ لا يقبل الفراغ في القاعدة. والذي لا رقمَ له
    مقيَّدٌ بنصٍّ يقول ذلك («بلا رقم») لا بفراغ — فمحوُه ممنوع، ويُقال
    لِمَ بدل أن يُردّ برسالةِ قاعدةٍ لا تُقرأ.
  */
  if (next.invoiceNumber === null || next.invoiceNumber.trim() === "") {
    return NextResponse.json(
      { error: "رقمُ الفاتورة لا يكون فارغاً. اكتب الرقم من الورقة، أو اكتب «بلا رقم» إن لم يكن لها رقم." },
      { status: 400 },
    );
  }

  if (next.totalMinor === null || next.totalMinor <= 0) {
    return NextResponse.json(
      { error: "الإجماليّ لا يكون فارغاً ولا صفراً — فاتورةٌ بلا مبلغٍ لا معنى لها." },
      { status: 400 },
    );
  }

  /*
    ما خُصّص عليها سقفٌ لا يُنزَل تحته: مؤثِّرُ `007` يرفض تجاوزَ
    الإجماليّ، فلو نقص الإجماليُّ دون المخصَّص انكسر الثابتُ في القاعدة
    ولم يُعرَف لِمَ.
  */
  if (next.totalMinor < Number(row.allocated)) {
    return NextResponse.json(
      {
        error:
          `خُصِّص على هذه الفاتورة ${formatRiyalsDisplay(Number(row.allocated))} ريالاً، `
          + "فلا يصحّ أن يقلّ إجماليُّها عن ذلك. تراجع عن التخصيص أوّلاً.",
      },
      { status: 409 },
    );
  }

  const [supplier] = row.supplierId
    ? await db
        .select({ issuesInvoices: suppliers.issuesInvoices, contractOnFile: suppliers.contractOnFile })
        .from(suppliers)
        .where(eq(suppliers.id, row.supplierId))
        .limit(1)
    : [];

  /*
    حالُ الضريبة تُعاد اشتقاقها — لا تُؤخَذ من المتصفّح. ومن يصحّح رقماً
    لا يقرّر معه أنّ الفاتورة صارت صالحة.
  */
  const review = reviewConfirmed(
    {
      documentKind: row.documentKind ?? "TAX_INVOICE",
      supplierId: row.supplierId,
      invoiceNumber: next.invoiceNumber,
      invoiceDate: row.invoiceDate ? row.invoiceDate.toISOString().slice(0, 10) : null,
      subtotalMinor: next.subtotalMinor,
      vatMinor: next.vatMinor,
      totalMinor: next.totalMinor,
      sellerVat: next.sellerVat,
      buyerVat: next.buyerVat,
    },
    {
      companyVat: companyConfig.vatNumber,
      supplierIssuesInvoices: supplier?.issuesInvoices,
      supplierContractOnFile: supplier?.contractOnFile,
    },
  );

  try {
    await db.transaction(async (t) => {
      /* الشهر المقفل لا يُكتب فيه من أيّ باب */
      if (row.periodMonth) await assertMonthsOpen(t, [row.periodMonth]);

      await t
        .update(invoices)
        .set({
          ...next,
          /* العمودان لا يقبلان الفراغ — وقد رُدَّ الفارغ قبل هذا */
          invoiceNumber: next.invoiceNumber as string,
          totalMinor: next.totalMinor as number,
          taxStatus: review.taxStatus,
          inputVatStatus: review.inputVatStatus,
        })
        .where(eq(invoices.id, id));
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }

  await recordAudit({
    actorId: user.id,
    action: "INVOICE_FIELDS_CORRECTED",
    entityType: "invoice",
    entityId: id,
    before: {
      invoiceNumber: row.invoiceNumber, sellerVat: row.sellerVat, buyerVat: row.buyerVat,
      subtotalMinor: row.subtotalMinor, vatMinor: row.vatMinor, totalMinor: row.totalMinor,
    },
    after: { ...next, taxStatus: review.taxStatus, inputVatStatus: review.inputVatStatus },
  });

  return NextResponse.json({
    ok: true,
    taxStatus: review.taxStatus,
    inputVatStatus: review.inputVatStatus,
    findings: review.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
  });
}
