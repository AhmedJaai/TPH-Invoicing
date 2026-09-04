/**
 * تصنيف حركة بنكية، وحفظ التصنيف قاعدةً.
 *
 * «سابع جار» يبدو مورّداً وهو إيجار، و«أحمد الجعيدي» يبدو مستفيداً وهو
 * المالك. ولا يصحّح هذا إلا صاحب العمل. فيقرّره مرّة، ويسري على ما يشبهه
 * في كل كشف بعده.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankRules, supplierAliases, suppliers } from "@/db/schema";
import { requireUser, UnauthenticatedError } from "@/lib/session";
import { ForbiddenError } from "@/lib/permissions";
import { normalizeName } from "@/lib/suppliers-seed";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const CATEGORIES: readonly TxCategory[] = [
  "SUPPLIER", "SALARY", "RENT", "ZAKAT", "UTILITY",
  "GOVERNMENT", "PERSONAL", "INTERNAL", "OTHER",
];

interface Body {
  /** النصّ المميِّز الذي تُعرف به هذه الحركة وأمثالها */
  pattern: string;
  category: TxCategory;
  /** يلزم حين يكون التصنيف SUPPLIER */
  supplierId?: string;
  note?: string;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser("bank:view");
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

  const pattern = body.pattern?.trim();
  if (!pattern) return NextResponse.json({ error: "اكتب النصّ المميِّز للحركة" }, { status: 400 });
  if (!CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "تصنيف غير معروف" }, { status: 400 });
  }

  const normalized = normalizeName(pattern);
  /*
   * النمط القصير يطابق كل شيء فيفسد الكشف كلّه. رفضه صراحةً خير من قبوله
   * ثمّ حيرة المستخدم لماذا صار كل تحويل «إيجاراً».
   */
  if (normalized.length < 3) {
    return NextResponse.json(
      { error: "النصّ قصير جداً — اكتب كلمة مميِّزة على الأقل" },
      { status: 400 },
    );
  }

  let supplierName: string | null = null;
  if (body.category === "SUPPLIER") {
    if (!body.supplierId) {
      return NextResponse.json({ error: "اختر المورّد" }, { status: 400 });
    }
    const [sup] = await db
      .select({ id: suppliers.id, nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(eq(suppliers.id, body.supplierId))
      .limit(1);
    if (!sup) return NextResponse.json({ error: "المورّد غير موجود" }, { status: 404 });
    supplierName = sup.nameAr;
  }

  const inserted = await db
    .insert(bankRules)
    .values({
      pattern,
      normalized,
      category: body.category,
      supplierId: body.category === "SUPPLIER" ? body.supplierId! : null,
      note: body.note ?? null,
      source: "MANUAL",
      createdById: user.id,
    })
    .onConflictDoUpdate({
      target: bankRules.normalized,
      set: {
        category: body.category,
        supplierId: body.category === "SUPPLIER" ? body.supplierId! : null,
        pattern,
      },
    })
    .returning({ id: bankRules.id });

  // تصنيفه مورّداً يعني أيضاً أنّ هذا اسمه في البنك — فيُحفظ اسماً بديلاً
  if (body.category === "SUPPLIER" && body.supplierId) {
    await db
      .insert(supplierAliases)
      .values({
        supplierId: body.supplierId,
        value: pattern,
        normalized,
        kind: "BANK_BENEFICIARY",
        source: "LEARNED",
      })
      .onConflictDoNothing();
  }

  await recordAudit({
    actorId: user.id,
    action: "SUPPLIER_ALIAS_LEARNED",
    entityType: "bank_rule",
    entityId: inserted[0].id,
    after: {
      النمط: pattern,
      التصنيف: CATEGORY_LABEL[body.category],
      المورّد: supplierName,
    },
  });

  return NextResponse.json({
    ok: true,
    id: inserted[0].id,
    message:
      body.category === "SUPPLIER"
        ? `«${pattern}» صار اسماً بنكياً لـ${supplierName}`
        : `«${pattern}» صُنّف ${CATEGORY_LABEL[body.category]}`,
  });
}
