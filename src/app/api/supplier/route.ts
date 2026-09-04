/**
 * إنشاء مورّد من شاشة الرفع.
 *
 * كان المورّد غير المعروف طريقاً مسدوداً: الخادم يرفض الأرشفة بلا مورّد،
 * والشاشة لا تتيح إنشاءه. فيقف المستخدم أمام فاتورة صحيحة لا يستطيع حفظها.
 */
import { NextResponse } from "next/server";
import { eq, or } from "drizzle-orm";
import { db } from "@/db";
import { supplierAliases, suppliers } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { normalizeName } from "@/lib/suppliers-seed";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  nameAr: string;
  nameEn?: string;
  /** اسم مجلد الدرايف — يُشتقّ من الاسم إن غاب */
  driveFolderName?: string;
  vatNumber?: string;
}

/**
 * رمز لاتيني قصير لاسم الملف.
 * العربي لا يصلح في الـslug لأنّ أسماء الأرشيف كلّها لاتينية، فنشتقّ من
 * الإنجليزي إن وُجد، وإلّا فمن حروف الاسم العربي مُحوَّلةً إلى رقم مميِّز.
 */
function deriveSlug(nameEn: string | undefined, nameAr: string): string {
  const latin = (nameEn ?? "")
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

  if (latin.length >= 2) return latin.slice(0, 32);

  // بلا اسم لاتيني: رمز مشتقّ من الاسم العربي، مميَّز ولو لم يكن جميلاً
  const digest = [...normalizeName(nameAr)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `SUP${digest.toString(36).toUpperCase().slice(0, 6)}`;
}

export async function POST(request: Request) {  let user;
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
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const nameAr = body.nameAr?.trim();
  if (!nameAr || nameAr.length < 2) {
    return NextResponse.json({ error: "اكتب اسم المورّد" }, { status: 400 });
  }

  const normalized = normalizeName(nameAr);

  // مورّد بالاسم نفسه موجود؟ نرجعه بدل أن ننشئ صفّاً ثانياً يقسم بياناته
  const existing = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug })
    .from(suppliers)
    .where(or(eq(suppliers.nameAr, nameAr), eq(suppliers.driveFolderName, nameAr)))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({
      ok: true, existed: true, supplier: existing[0],
      message: `«${existing[0].nameAr}» مسجّل مسبقاً`,
    });
  }

  let slug = deriveSlug(body.nameEn, nameAr);
  const taken = await db.select({ slug: suppliers.slug }).from(suppliers).where(eq(suppliers.slug, slug));
  if (taken.length > 0) slug = `${slug}2`;

  const [created] = await db
    .insert(suppliers)
    .values({
      slug,
      driveFolderName: body.driveFolderName?.trim() || nameAr,
      nameAr,
      nameEn: body.nameEn?.trim() || null,
      vatNumber: body.vatNumber?.trim() || null,
    })
    .returning({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug });

  // اسمه نفسه اسمٌ بديل صالح للمطابقة مستقبلاً
  await db
    .insert(supplierAliases)
    .values({ supplierId: created.id, value: nameAr, normalized, kind: "NAME_VARIANT", source: "MANUAL" })
    .onConflictDoNothing();

  await recordAudit({
    actorId: user.id,
    action: "SUPPLIER_CREATED",
    entityType: "supplier",
    entityId: created.id,
    after: { الاسم: nameAr, الرمز: slug, "مجلد الدرايف": body.driveFolderName?.trim() || nameAr },
  });

  return NextResponse.json({
    ok: true, existed: false, supplier: created,
    message: `أُنشئ «${nameAr}» برمز ${slug}`,
  });
}
