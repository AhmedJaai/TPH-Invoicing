/**
 * تعليم النظام اسم المورّد في البنك.
 *
 * وصف الحركة البنكية يخالف اسم المورّد غالباً: «شركة أنس غالب حمزة خاشقجي»
 * هي غاناش. ولا سبيل لمعرفة ذلك إلا من صاحب العمل. فحين يربط تحويلاً مجهولاً
 * بمورّده، يُحفظ الاسم اسماً بديلاً، فتُطابَق كل حركة مشابهة بعدها تلقائياً.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { supplierAliases, suppliers } from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { normalizeName } from "@/lib/suppliers-seed";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  supplierId: string;
  /** الاسم كما يظهر في البنك */
  value: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("supplier:edit");
  } catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: e.message }, { status: 401 });
    if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const value = body.value?.trim();
  if (!body.supplierId || !value) {
    return NextResponse.json({ error: "حدّد المورّد والاسم البنكي" }, { status: 400 });
  }

  const normalized = normalizeName(value);
  /*
   * الاسم القصير يطابق الجميع فيفسد المطابقة كلها. ثلاثة أحرف حدّ أدنى
   * معقول، ورفضه صراحةً خير من قبوله ثم حيرة المستخدم لماذا صار كل تحويل
   * ينسب إلى مورّد واحد.
   */
  if (normalized.length < 3) {
    return NextResponse.json(
      { error: "الاسم البنكي قصير جداً — اكتب كلمة مميِّزة على الأقل" },
      { status: 400 },
    );
  }

  const [supplier] = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(eq(suppliers.id, body.supplierId))
    .limit(1);

  if (!supplier) return NextResponse.json({ error: "المورّد غير موجود" }, { status: 404 });

  const inserted = await db
    .insert(supplierAliases)
    .values({
      supplierId: supplier.id,
      value,
      normalized,
      kind: "BANK_BENEFICIARY",
      source: "LEARNED",
    })
    .onConflictDoNothing()
    .returning({ id: supplierAliases.id });

  if (inserted.length === 0) {
    return NextResponse.json({
      ok: true,
      already: true,
      message: `«${value}» مسجّل مسبقاً لـ${supplier.nameAr}`,
    });
  }

  await recordAudit({
    actorId: user.id,
    action: "SUPPLIER_ALIAS_LEARNED",
    entityType: "supplier",
    entityId: supplier.id,
    after: { المورّد: supplier.nameAr, الاسم_البنكي: value, المصدر: "ربط يدوي من كشف البنك" },
  });

  return NextResponse.json({
    ok: true,
    already: false,
    message: `حُفظ «${value}» اسماً بنكياً لـ${supplier.nameAr}`,
  });
}
