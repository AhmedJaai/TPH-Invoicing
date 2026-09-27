/**
 * إعادةُ قراءة مستندٍ مؤرشف — معاينةً أوّلاً، ثمّ كتابةً بإقرار.
 *
 * ── لماذا وُجد هذا المسار ──
 *
 * ثمانِ فواتير في أرشيف المقهى **بلا بندٍ واحد**: الإجماليُّ معروفٌ ولا
 * يُعرَف ممّ تكوّن. وسبعٌ «لم تُقرأ ضريبتها». والشاشةُ كانت تقول ذلك
 * وتقف — لا زرَّ يُعيد القراءة، ولا سبيلَ إلى إصلاحه إلّا أن يُرفَع
 * الملفُّ من جديد وقد صار في الأرشيف.
 *
 * والفاتورةُ بلا بنودٍ تخرج من مقارنة الأسعار ومن تحليل الأصناف كلَّه.
 * فالنقصُ لا يقف عندها.
 *
 * ── ولا يُكتَب شيءٌ حتى يُقرّه الإنسان ──
 *
 * طلبٌ بلا `apply` يقرأ ويعرض ما قرأ، ولا يمسّ صفّاً. وبـ`apply` يكتب
 * ما عُرض. وهذا قيدٌ قائم في المشروع: «الكتابة من planned وحده،
 * والاقتراح لا يُكتَب ينتظر تأكيداً».
 *
 * **ولا يُكتَب رقمُ فاتورةٍ من النموذج** — وهو قيدٌ قديم: اختلق النموذج
 * `TPH-20260521` بثقة ١٫٠٠. فالمعادُ قراءتُه هنا البنودُ والمبالغ
 * وأرقامُ الضريبة، ويبقى رقمُ الفاتورة على ما قُيِّد. ومن أراد تصحيحه
 * كتبه بيده في `/api/invoice-fields`.
 */
import { NextResponse } from "next/server";
import { guard, respondTo } from "@/services/guard";
import { driveForUser } from "@/lib/drive";
import { refreshTokenFor } from "@/services/drive.service";
import { withDeadline } from "@/lib/ai/deadline";
import { rereadDocument } from "@/services/document-reread.service";
import { z } from "zod";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** بلا `apply`: معاينةٌ لا تمسّ صفّاً. */
const Body = z.object({
  documentId: z.string().trim().min(1).max(64),
  apply: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("document-reread", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  /*
    إعادةُ القراءة قراءةٌ لمبالغ الفاتورة وكتابةٌ لها — فلا تُفتح لمن لا يراها.
    كانت بصلاحية الرفع وحدها، فيرى مديرُ المشتريات الصافيَ والضريبةَ والإجماليّ
    في المعاينة ويكتبها، وهو ما يمنعه «صحّح الحقول». والرقمُ والتاريخ يُصحَّحان هناك.
  */
  if (!can(user.role, "amounts:view")) {
    return NextResponse.json({ error: "إعادةُ قراءة الفاتورة تحتاج صلاحية عرض المبالغ — وتصحيحُ الرقم والتاريخ من «صحّح الحقول»." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "تعذّرت قراءة الطلب. أعد المحاولة." }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "لم يُذكر المستند" }, { status: 400 });
  const body = parsed.data;
  const id = body.documentId;

  /*
    وضعُ التجربة لا تفويضَ درايف له عمداً (`refreshTokenFor`) — فلا يرفع
    ولا يقرأ باسم المالك من بيئةٍ بلا دخول. ويُقال ذلك صراحةً بدل أن
    يسقط بخطأٍ لا يُفهَم.
  */
  const token = await refreshTokenFor(user.id);
  if (!token) {
    return NextResponse.json(
      {
        error:
          "لا تفويضَ درايف في هذه البيئة — إعادةُ القراءة تعمل في الإنتاج وحده. "
          + "وتصحيحُ الحقول بيدك يعمل هنا.",
      },
      { status: 409 },
    );
  }

  /* المسار يعلن عمره، وكلّ محاولة نداءٍ تأخذ ما بقي منه. */
  const r = await withDeadline(55_000, () =>
    rereadDocument({ documentId: id, actorId: user.id, drive: driveForUser(token), apply: body.apply === true }),
  );
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r);
}
