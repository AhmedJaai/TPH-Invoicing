/**
 * سياسةُ مستندات المورّد: أيُطلَب منه عقد؟ وهل فواتيرُه ورقيّة؟
 *
 * كان الحكمُ مشتقّاً من البيانات وحدها: «لا يصدر فواتير وبلا عقد ⇒
 * تنبيهٌ دائم». وذلك يصحّ في مورّدٍ يبيع بانتظامٍ بلا مستند، ولا يصحّ في
 * من يُشترى منه مرّةً في السنة، ولا في من يعطي ورقةً باليد.
 *
 * **والتنبيهُ الذي يُعرَض على ما لا يُفعَل فيه شيء يُعلّم صاحبَه تجاهلَ
 * التنبيهات كلّها** — وهو أغلى ما يُفقَد في نظامٍ كلُّ قيمته أن يُنظَر
 * إلى تنبيهاته. فصار لصاحب العمل أن يقول: هذا لا يحتاج عقداً، وهذا
 * فواتيرُه ورقيّة.
 *
 * ولا شيء يُشتقّ: الافتراضُ يبقى على حاله حتى يقول الإنسانُ غيرَه.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";

export const runtime = "nodejs";

interface Body {
  supplierId?: string;
  issuesInvoices?: boolean;
  paperInvoices?: boolean;
  contractRequired?: boolean;
  contractOnFile?: boolean;
  /** أيصدر كشفَ حساب؟ (044) */
  issuesStatements?: boolean;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("supplier-policy", "supplier:edit");
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

  const id = body.supplierId?.trim();
  if (!id) return NextResponse.json({ error: "لم يُذكر المورّد" }, { status: 400 });

  const [before] = await db
    .select({
      nameAr: suppliers.nameAr,
      issuesInvoices: suppliers.issuesInvoices,
      paperInvoices: suppliers.paperInvoices,
      contractRequired: suppliers.contractRequired,
      contractOnFile: suppliers.contractOnFile,
      issuesStatements: suppliers.issuesStatements,
    })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "لا مورّد بهذا المعرّف" }, { status: 404 });

  /* ما لم يُرسَل يبقى كما هو — الطلبُ الجزئيّ لا يمحو ما لم يُذكَر. */
  const next = {
    issuesInvoices: body.issuesInvoices ?? before.issuesInvoices,
    paperInvoices: body.paperInvoices ?? before.paperInvoices,
    contractRequired: body.contractRequired ?? before.contractRequired,
    contractOnFile: body.contractOnFile ?? before.contractOnFile,
    issuesStatements: body.issuesStatements ?? before.issuesStatements,
  };

  /*
    التناقضُ يُمنَع هنا وفي القاعدة معاً: «فواتيرُه ورقيّة» تقول إنّ
    الفاتورة موجودةٌ ولم تُرفَع، و«لا يصدر فواتير» تقول إنّها غير
    موجودة. والقيدُ في الهجرة 035 يردّها، لكنّ الرسالة هنا تُقرأ.
  */
  if (next.paperInvoices && !next.issuesInvoices) {
    return NextResponse.json(
      {
        error:
          "لا يجتمعان: «فواتيره ورقيّة» تعني أنّها موجودةٌ ولم تُرفَع، و«لا يصدر فواتير» تعني أنّها غير موجودة. اختر واحدة.",
      },
      { status: 400 },
    );
  }

  await db.update(suppliers).set(next).where(eq(suppliers.id, id));

  await recordAudit({
    actorId: user.id,
    action: "SUPPLIER_UPDATED",
    entityType: "supplier",
    entityId: id,
    before,
    after: next,
  });

  return NextResponse.json({ ok: true, policy: next });
}
