/**
 * إنشاء مورّد من شاشة الرفع.
 *
 * كان المورّد غير المعروف طريقاً مسدوداً: الخادم يرفض الأرشفة بلا مورّد،
 * والشاشة لا تتيح إنشاءه. فيقف المستخدم أمام فاتورة صحيحة لا يستطيع حفظها.
 */
import { z } from "zod";
import { readJson } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { createSupplier } from "@/services/supplier.service";
import { isValidSaudiVat } from "@/lib/validation";
import { latinDigits } from "@/lib/invoice-number";

export const runtime = "nodejs";

const Body = z.object({
  nameAr: z.string().max(200).optional().default(""),
  nameEn: z.string().max(200).optional(),
  /** اسم مجلد الدرايف — يُشتقّ من الاسم إن غاب */
  driveFolderName: z.string().max(200).optional(),
  /*
    الرقمُ الضريبيّ السعوديّ ١٥ خانةً تبدأ وتنتهي بـ٣ (`isValidSaudiVat`). كان
    يُحفظ أيُّ نصٍّ حتّى ٣٠ حرفاً — ورقمٌ ناقصٌ خانةً يصير هويّةً لا تطابق شيئاً.
    والفارغُ «غير معروف» ومقبول.
  */
  vatNumber: z.string().max(30).optional()
    .refine((v) => !v?.trim() || isValidSaudiVat(v), "الرقم الضريبيّ 15 رقماً يبدأ بـ3 وينتهي بـ3 — صحّحه أو اتركه فارغاً"),
  /** «هو غيرُ من يشبهونه» — بعد ردّ 409 `similar`. */
  confirmNew: z.boolean().optional(),
});
type Body = z.infer<typeof Body>;

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("supplier", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body: Body = read.body;

  const nameAr = body.nameAr?.trim();
  if (!nameAr || nameAr.length < 2) {
    return NextResponse.json({ error: "اكتب اسم المورّد" }, { status: 400 });
  }

  /* الإنشاء في الخدمة وحدها — وفيها التدقيقُ داخل معاملة الإنشاء */
  let out;
  try {
    out = await createSupplier({
      nameAr,
      nameEn: body.nameEn,
      driveFolderName: body.driveFolderName,
      vatNumber: body.vatNumber ? latinDigits(body.vatNumber) : undefined,
      confirmNew: body.confirmNew,
    }, user.id);
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  if (out.kind === "similar") {
    return NextResponse.json({
      error: `يشبه ${out.similar.map((s) => `«${s.nameAr}»`).join(" و")} المسجَّل — اختره إن كان هو، أو أنشئه جديداً إن كان غيرَه`,
      similar: out.similar,
    }, { status: 409 });
  }

  const supplier = { id: out.id, nameAr: out.nameAr, slug: out.slug };
  if (out.kind === "existed") {
    return NextResponse.json({
      ok: true, existed: true, supplier,
      message: out.by === "VAT"
        ? `هذا الرقمُ الضريبيّ مسجَّلٌ لـ«${out.nameAr}» — اختير هو`
        : `«${out.nameAr}» مسجّل مسبقاً`,
    });
  }

  return NextResponse.json({
    ok: true, existed: false, supplier,
    message: `أُنشئ «${nameAr}» برمز ${out.slug}`,
  });
}
