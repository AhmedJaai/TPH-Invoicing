/**
 * حسمُ مستندٍ ينتظر قراراً: يُرفض، أو يُؤكَّد.
 *
 * كانت «راجعها وأرشفها أو ارفضها» تحيل إلى قائمةٍ لا زرّ فيها إلّا
 * «افتحه» — قائمةُ عملٍ بلا وسيلةٍ لإنقاصها. والأرشفة تمرّ بشاشة الرفع
 * (فيها قراءة الحقول وتأكيدها)، أمّا الرفض فقرارٌ بسيط: هذا ليس مستنداً
 * يُقيَّد. ويُسجَّل بسببه ومن رفضه، ولا يُحذف الملفّ من الدرايف.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { recordAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";

export const runtime = "nodejs";

interface Body {
  documentId?: string;
  reason?: string;
  /** «confirm»: ما قرأه النموذج صحيح فيُؤرشَف — والافتراضيّ الرفض */
  action?: "reject" | "confirm";
}

export async function POST(request: Request) {
  let user;
  try {
    user = await guard("document-status", "document:upload");
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
  if (!body.documentId) return NextResponse.json({ error: "حدّد المستند" }, { status: 400 });

  /*
    ── التأكيد ──

    المزامنة تقيّد ما قرأه النموذج «ينتظر المراجعة»، ولا يدخل ملفّ
    التحويلات حتى يُؤكَّد. والتأكيد إقرارٌ بمبلغٍ مستحقّ، فيحتاج من يرى
    المبالغ — لا مَن يرفع المستندات وحده.
  */
  if (body.action === "confirm") {
    if (!can(user.role, "amounts:view")) {
      return NextResponse.json({ error: "تأكيد المستند يحتاج صلاحية عرض المبالغ" }, { status: 403 });
    }
    const confirmed = await db.transaction(async (t) => {
      const rows = await t
        .update(documents)
        .set({ status: "ARCHIVED" })
        .where(and(eq(documents.id, body.documentId!), eq(documents.status, "NEEDS_REVIEW")))
        .returning({ id: documents.id, fileName: documents.fileName });
      if (rows.length === 0) return null;
      await recordAudit({
        actorId: user.id,
        action: "DOCUMENT_STATUS_CHANGED",
        entityType: "document",
        entityId: rows[0].id,
        before: { الحال: "ينتظر المراجعة" },
        after: { الملف: rows[0].fileName, الحال: "مؤرشف", السبب: "أكّد ما قرأه النموذج" },
      }, t);
      return rows[0];
    });
    if (!confirmed) {
      return NextResponse.json({ error: "المستند ليس بانتظار مراجعة — ربما حُسم من نافذةٍ أخرى" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, message: "أُكِّد المستند — ويدخل فاتورتُه دفعةَ الشهر" });
  }

  const reason = body.reason?.trim() || "رُفض من صفحة المستندات";

  const changed = await db.transaction(async (t) => {
    const rows = await t
      .update(documents)
      .set({ status: "REJECTED" })
      .where(and(
        eq(documents.id, body.documentId!),
        /* المؤرشف لا يُرفض من هنا — له فاتورته وأثره */
        inArray(documents.status, ["PENDING", "EXTRACTED", "NEEDS_REVIEW"]),
      ))
      .returning({ id: documents.id, fileName: documents.fileName });
    if (rows.length === 0) return null;
    await recordAudit({
      actorId: user.id,
      action: "DOCUMENT_REJECTED",
      entityType: "document",
      entityId: rows[0].id,
      after: { الملف: rows[0].fileName, السبب: reason },
    }, t);
    return rows[0];
  });

  if (!changed) {
    return NextResponse.json({ error: "المستند ليس بانتظار قرار — ربما حُسم من نافذةٍ أخرى" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, message: "رُفض المستند — وملفّه باقٍ في الدرايف كما هو" });
}
