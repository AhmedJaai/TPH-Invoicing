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
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const Body = z.object({
  nameAr: z.string().max(200).optional().default(""),
  nameEn: z.string().max(200).optional(),
  /** اسم مجلد الدرايف — يُشتقّ من الاسم إن غاب */
  driveFolderName: z.string().max(200).optional(),
  vatNumber: z.string().max(30).optional(),
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

  /* الإنشاء في الخدمة وحدها — كان مكتوباً هنا مرّةً ثانية بقواعده */
  let created;
  try {
    created = await createSupplier({
      nameAr,
      nameEn: body.nameEn,
      driveFolderName: body.driveFolderName,
      vatNumber: body.vatNumber,
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  if (created.existed) {
    return NextResponse.json({
      ok: true, existed: true, supplier: { id: created.id, nameAr: created.nameAr, slug: created.slug },
      message: `«${created.nameAr}» مسجّل مسبقاً`,
    });
  }

  const slug = created.slug;
  await recordAudit({
    actorId: user.id,
    action: "SUPPLIER_CREATED",
    entityType: "supplier",
    entityId: created.id,
    after: { الاسم: nameAr, الرمز: slug, "مجلد الدرايف": body.driveFolderName?.trim() || nameAr },
  });

  return NextResponse.json({
    ok: true, existed: false, supplier: { id: created.id, nameAr: created.nameAr, slug: created.slug },
    message: `أُنشئ «${nameAr}» برمز ${slug}`,
  });
}
