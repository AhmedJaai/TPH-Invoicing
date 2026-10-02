import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import { can } from "@/lib/permissions";
import { parseRiyals } from "@/lib/money";
import { correctInvoice, InvoiceCorrectionRefused } from "@/services/invoice-correction.service";
import { MonthClosedError } from "@/services/validation.service";

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
 *   • **كلُّ تغييرٍ في سجلّ التدقيق** بقيمته قبلَه وبعدَه — في المعاملة نفسها.
 *   • **والتاريخُ والمورّدُ يُصحَّحان** (`invoice-correction.service.ts`): الشهرُ
 *     يتبع التاريخ، وتغييرُ المورّد يفكّ عنها سدادَ السابق.
 */

export const runtime = "nodejs";

/** غيابُ المفتاح «اتركه»، والفراغُ «امحُه». والمبالغُ نصّاً كما يكتبها الإنسان. */
const Text = z.string().max(200).nullable().optional();
const Body = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  invoiceNumber: Text,
  sellerVat: Text,
  buyerVat: Text,
  subtotal: Text,
  vat: Text,
  total: Text,
  /** الخصمُ بعد الضريبة إن كان على الورقة */
  discount: Text,
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD").optional(),
  supplierId: z.string().trim().min(1).max(64).optional(),
}).strict();

/** ما لا يُقرأ رقماً يُترَك على حاله ولا يُكتَب صفراً. */
function amount(v: string | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v.trim() === "") return null;
  return parseRiyals(v) ?? undefined;
}

export async function POST(request: Request) {
  try {
    const user = await guard("invoice-fields", "document:upload");
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
    }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "طلبٌ غير مفهوم" }, { status: 400 });
    const b = parsed.data;

    /*
      المبلغُ لا يكتبه من لا يراه — ولا المورّدُ: تغييرُه يفكّ سداداً ويخصم رصيداً.
      الصلاحيةُ صلاحيةُ رفع (مديرُ المشتريات يصحّح الرقمَ والتاريخ)، والشاشةُ ليست حارساً.
    */
    const touchesMoney = b.subtotal !== undefined || b.vat !== undefined || b.total !== undefined || b.discount !== undefined || b.supplierId !== undefined;
    if (touchesMoney && !can(user.role, "amounts:view")) {
      return NextResponse.json({ error: "تعديل المبالغ أو المورّد يحتاج صلاحية عرض المبالغ — اطلبه من مالك الحساب." }, { status: 403 });
    }

    const out = await db.transaction((tx) => correctInvoice(tx, {
      invoiceId: b.invoiceId,
      invoiceNumber: b.invoiceNumber,
      sellerVat: b.sellerVat,
      buyerVat: b.buyerVat,
      subtotalMinor: amount(b.subtotal),
      vatMinor: amount(b.vat),
      totalMinor: amount(b.total),
      discountMinor: amount(b.discount),
      invoiceDate: b.invoiceDate,
      supplierId: b.supplierId,
    }, user.id));

    return NextResponse.json({
      ok: true,
      taxStatus: out.review.taxStatus,
      inputVatStatus: out.review.inputVatStatus,
      releasedMinor: out.releasedMinor,
      findings: out.review.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message })),
    });
  } catch (e) {
    if (e instanceof InvoiceCorrectionRefused) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof MonthClosedError) return NextResponse.json({ error: e.message }, { status: 409 });
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
