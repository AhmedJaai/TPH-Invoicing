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
import { bankRules, suppliers } from "@/db/schema";
import { learnAlias } from "@/services/supplier.service";
import { guard, respondTo } from "@/services/guard";
import { normalizeName } from "@/lib/suppliers-seed";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

const CATEGORIES: readonly TxCategory[] = [
  "SUPPLIER", "SALARY", "RENT", "ZAKAT", "UTILITY",
  "GOVERNMENT", "PERSONAL", "INTERNAL", "OTHER",
];

interface Body {
  /** «delete» يحذف قاعدةً بمعرّفها — والافتراضيّ الإنشاء */
  action?: "delete";
  id?: string;
  /** النصّ المميِّز الذي تُعرف به هذه الحركة وأمثالها */
  pattern: string;
  category: TxCategory;
  /** يلزم حين يكون التصنيف SUPPLIER */
  supplierId?: string;
  note?: string;
}

export async function POST(request: Request) {  let user;
  try {
    user = await guard("bank-rule", "bank:edit");
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

  /*
    ── حذف قاعدة ──

    قاعدةٌ خاطئة كانت لا تُرى ولا تُمحى من الواجهة، وتسري على كلّ كشفٍ بعدها.
    والحذف يوقف سريانها على القادم؛ وما صنّفته من قبل يبقى حتى يُعاد تصنيفه.
  */
  if (body.action === "delete") {
    if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "حدّد القاعدة" }, { status: 400 });
    const [gone] = await db
      .delete(bankRules)
      .where(eq(bankRules.id, body.id))
      .returning({ id: bankRules.id, pattern: bankRules.pattern, category: bankRules.category });
    if (!gone) return NextResponse.json({ error: "القاعدة غير موجودة — ربما حُذفت من نافذةٍ أخرى" }, { status: 404 });
    await recordAudit({
      actorId: user.id,
      action: "BANK_RULE_DELETED",
      entityType: "bank_rule",
      entityId: gone.id,
      before: { النمط: gone.pattern, التصنيف: CATEGORY_LABEL[gone.category as TxCategory] ?? gone.category },
    });
    return NextResponse.json({ ok: true, message: `حُذفت قاعدة «${gone.pattern}» — ولا تسري على الكشوف القادمة` });
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

  /* ما يُستبدَل يُقال — كانت القاعدة القائمة تُكتب فوقها بصمت */
  const [previous] = await db
    .select({ category: bankRules.category })
    .from(bankRules)
    .where(eq(bankRules.normalized, normalized))
    .limit(1);

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

  /*
    تصنيفه مورّداً يعني أيضاً أنّ هذا اسمه في البنك — فيُحفظ اسماً بديلاً.
    وعبر `learnAlias` لا بإدراجٍ هنا: كان هذا الموضع يكتب الاسم بلا حدّها
    الأدنى، فنمطٌ من حرفين يصير اسماً بديلاً يطابق كلّ مستفيد.
  */
  if (body.category === "SUPPLIER" && body.supplierId) {
    await learnAlias(db, body.supplierId, pattern);
  }

  await recordAudit({
    actorId: user.id,
    action: "BANK_RULE_LEARNED",
    entityType: "bank_rule",
    entityId: inserted[0].id,
    after: {
      النمط: pattern,
      التصنيف: CATEGORY_LABEL[body.category],
      ...(previous ? { "كان": CATEGORY_LABEL[previous.category as keyof typeof CATEGORY_LABEL] ?? previous.category } : {}),
      المورّد: supplierName,
    },
  });

  return NextResponse.json({
    ok: true,
    id: inserted[0].id,
    message:
      (body.category === "SUPPLIER"
        ? `«${pattern}» صار اسماً بنكياً لـ${supplierName}`
        : `«${pattern}» صُنّف ${CATEGORY_LABEL[body.category]}`)
      + (previous && previous.category !== body.category
        ? ` — واستُبدلت قاعدةٌ كانت تصنّفه ${CATEGORY_LABEL[previous.category as keyof typeof CATEGORY_LABEL] ?? previous.category}`
        : ""),
  });
}
