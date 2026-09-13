/**
 * إنشاء مورّد من شاشة الرفع.
 *
 * كان المورّد غير المعروف طريقاً مسدوداً: الخادم يرفض الأرشفة بلا مورّد،
 * والشاشة لا تتيح إنشاءه. فيقف المستخدم أمام فاتورة صحيحة لا يستطيع حفظها.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { createSupplier } from "@/services/supplier.service";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  nameAr: string;
  nameEn?: string;
  /** اسم مجلد الدرايف — يُشتقّ من الاسم إن غاب */
  driveFolderName?: string;
  vatNumber?: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("supplier", "supplier:edit");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب." }, { status: 400 });
  }

  const nameAr = body.nameAr?.trim();
  if (!nameAr || nameAr.length < 2) {
    return NextResponse.json({ error: "اكتب اسم المورّد" }, { status: 400 });
  }

  /* الإنشاء في الخدمة وحدها — كان مكتوباً هنا مرّةً ثانية بقواعده */
  const created = await createSupplier({
    nameAr,
    nameEn: body.nameEn,
    driveFolderName: body.driveFolderName,
    vatNumber: body.vatNumber,
  });

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
