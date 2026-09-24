/**
 * حسمُ مستندٍ ينتظر قراراً: يُرفض، أو يُؤكَّد.
 *
 * كانت «راجعها وأرشفها أو ارفضها» تحيل إلى قائمةٍ لا زرّ فيها إلّا
 * «افتحه» — قائمةُ عملٍ بلا وسيلةٍ لإنقاصها. والأرشفة تمرّ بشاشة الرفع
 * (فيها قراءة الحقول وتأكيدها)، أمّا الرفض فقرارٌ بسيط: هذا ليس مستنداً
 * يُقيَّد. ويُسجَّل بسببه ومن رفضه، ولا يُحذف الملفّ من الدرايف.
 */
import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, statements } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { assertMonthsOpen } from "@/services/month-guard";
import { recordAudit } from "@/lib/audit";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { renameArchived } from "@/services/drive-rename.service";
import { loadPendingReview } from "@/services/document-review.service";
import { refreshTokenFor } from "@/services/drive.service";
import { driveForUser } from "@/lib/drive";
import { driveWritesAllowed } from "@/lib/drive-readonly";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { can } from "@/lib/permissions";
import { formatRiyalsDisplay } from "@/lib/money";

export const runtime = "nodejs";

interface Body {
  documentId?: string;
  reason?: string;
  /** «confirm»: ما قرأه النموذج صحيح فيُؤرشَف — والافتراضيّ الرفض */
  action?: "reject" | "confirm" | "confirm-eligible";
}

const UNDECIDED = ["PENDING", "EXTRACTED", "NEEDS_REVIEW"] as const;

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
  /*
    ── اعتمادُ ما اجتمعت فيه الشروط الأربعة ── (إذن أحمد في ٢٤ سبتمبر ٢٠٢٦)

    ما انتظر قبل أن توجد القاعدة: يُعاد الحكمُ عليه هنا من القيد —
    لا تُؤخَذ من المتصفّح قائمة — ثمّ يُعتمَد كلٌّ في معاملته كالاعتماد
    اليدويّ تماماً (خصمُ رصيد المورّد، والأثر)، ويُسمّى ما اعتُمد.
  */
  if (body.action === "confirm-eligible") {
    if (!can(user.role, "amounts:view")) {
      return NextResponse.json({ error: "الاعتماد يحتاج صلاحية عرض المبالغ" }, { status: 403 });
    }
    const eligible = (await loadPendingReview()).filter((d) => d.status === "NEEDS_REVIEW" && d.verdict.auto);
    const done: string[] = [];
    const skipped: string[] = [];
    for (const d of eligible.slice(0, 50)) {
      try {
        const ok = await db.transaction(async (t) => {
          const rows = await t.update(documents).set({ status: "ARCHIVED" })
            .where(and(eq(documents.id, d.id), eq(documents.status, "NEEDS_REVIEW")))
            .returning({ id: documents.id });
          if (rows.length === 0) return false;
          await recordAudit({
            actorId: user.id,
            action: "DOCUMENT_STATUS_CHANGED",
            entityType: "document",
            entityId: d.id,
            before: { الحال: "ينتظر المراجعة" },
            after: { الملف: d.fileName, الحال: "مؤرشف", السبب: "اجتمعت فيه شروطُ الأرشفة الآليّة الأربعة" },
          }, t);
          if (d.supplierId) await applySupplierCredit(t, d.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });
          return true;
        });
        if (ok && d.driveFileId) done.push(d.driveFileId);
        else if (ok) done.push(d.id);
      } catch (e) {
        skipped.push(`${d.fileName}: ${(e as Error).message.slice(0, 80)}`);
      }
    }
    let renamed = 0;
    if (done.length > 0 && driveWritesAllowed(process.env)) {
      try {
        const token = await refreshTokenFor(user.id);
        if (token) renamed = (await renameArchived(driveForUser(token), done, user.id, "الاعتماد الجماعيّ")).done.length;
      } catch (e) {
        console.warn("[document-status] تعذّرت التسمية بعد الاعتماد الجماعيّ:", (e as Error).message);
      }
    }
    const message = done.length === 0
      ? "لا مستندَ تجتمع فيه الشروطُ الآن"
      : `اعتُمد ${done.length}`
        + (renamed > 0 ? ` · وسُمّي ${renamed}` : "")
        + (skipped.length > 0 ? ` · وتعذّر ${skipped.length}: ${skipped[0]}` : "")
        + (eligible.length > 50 ? ` · بقي ${eligible.length - 50} — اضغط ثانيةً` : "");
    return NextResponse.json({ ok: true, message, confirmed: done.length, skipped });
  }

  if (typeof body.documentId !== "string" || !body.documentId) {
    return NextResponse.json({ error: "حدّد المستند" }, { status: 400 });
  }
  const documentId = body.documentId;

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
        .where(and(eq(documents.id, documentId), eq(documents.status, "NEEDS_REVIEW")))
        .returning({ id: documents.id, fileName: documents.fileName });
      if (rows.length === 0) return null;
      const [linked] = await t
        .select({
          invoices: sql<number>`(select count(*) from invoices i where i.document_id = ${documents}.id)::int`,
          statements: sql<number>`(select count(*) from statements s where s.document_id = ${documents}.id)::int`,
        })
        .from(documents)
        .where(eq(documents.id, rows[0].id));
      await recordAudit({
        actorId: user.id,
        action: "DOCUMENT_STATUS_CHANGED",
        entityType: "document",
        entityId: rows[0].id,
        before: { الحال: "ينتظر المراجعة" },
        after: { الملف: rows[0].fileName, الحال: "مؤرشف", السبب: "أكّد ما قرأه النموذج" },
      }, t);
      /*
        الرفعُ ممّن لا يرى المبالغ يُقيَّد «ينتظر المراجعة» ولا يُخصم عليه
        رصيدُ المورّد — بانتظار هذا التأكيد بعينه. فكان التأكيدُ يحوّل
        الحال وحدها، وتبقى الفاتورةُ مستحقّةً كاملةً ومالٌ دُفع للمورّد
        قبلها لا يُخصم منها: فتدخل دفعةَ الشهر ويُدفَع الريالُ مرّتين.
        والخصمُ لا يتكرّر — ما خُصم في المزامنة لا يُخصم ثانيةً.
      */
      const [inv] = await t
        .select({ supplierId: invoices.supplierId })
        .from(invoices)
        .where(eq(invoices.documentId, rows[0].id))
        .limit(1);
      if (inv?.supplierId) {
        await applySupplierCredit(t, inv.supplierId, { forwardDays: SETTLEMENT_FORWARD_DAYS });
      }
      return { ...rows[0], invoices: linked?.invoices ?? 0, statements: linked?.statements ?? 0 };
    });
    if (!confirmed) {
      return NextResponse.json({ error: "المستند ليس بانتظار مراجعة — ربما حُسم من نافذةٍ أخرى" }, { status: 409 });
    }
    /*
      ── وما اعتُمد يُسمّى ── (إذن أحمد في ٢٤ سبتمبر ٢٠٢٦)

      اسمُه يُبنى الآن من قيدٍ أقرّه إنسان. والتسميةُ لا توقف الاعتماد:
      إن تعذّرت (لا تفويض، أو بيئةُ معاينة) بقي الملفّ باسمه واقتُرح في
      شاشة التسمية.
    */
    let renamedTo: string | null = null;
    if (driveWritesAllowed(process.env)) {
      try {
        const [doc] = await db.select({ driveFileId: documents.driveFileId })
          .from(documents).where(eq(documents.id, confirmed.id)).limit(1);
        const token = doc?.driveFileId ? await refreshTokenFor(user.id) : null;
        if (doc?.driveFileId && token) {
          const outcome = await renameArchived(driveForUser(token), [doc.driveFileId], user.id, "الاعتماد");
          renamedTo = outcome.done[0]?.to ?? null;
        }
      } catch (e) {
        console.warn("[document-status] تعذّرت التسمية بعد الاعتماد:", (e as Error).message);
      }
    }
    /* الرسالة تقول ما وقع: لا «دخلت فاتورتُه الدفعة» لمستندٍ لا فاتورة له */
    const message = confirmed.invoices > 0
      ? "اعتُمد المستند — وتدخل فاتورتُه دفعةَ الشهر، ويُخصم منها ما دُفع للمورّد مقدَّماً"
      : confirmed.statements > 0
        ? "اعتُمد الكشف"
        : "اعتُمد المستند — ولا فاتورةَ مقيَّدة له بعد: ارفعه من صفحة الرفع ليُقرأ ويُقيَّد";
    return NextResponse.json({ ok: true, message: renamedTo ? `${message} · وسُمّي ${renamedTo}` : message });
  }

  const reason = body.reason?.trim().slice(0, 500) || "رُفض من صفحة المستندات";

  /*
    ── الرفض ──

    كان يحوّل حال المستند وحده، فتبقى فاتورتُه — التي قرأها النموذج ولم
    يُقرّها إنسان — مستحقّةً، ويرتفع عنها حجزُ «ينتظر المراجعة» فتدخل ملفّ
    التحويلات: الرفضُ نفسه كان يُطلق المال. فالرفض الآن يُسقط قيدَ المستند
    معه في معاملةٍ واحدة، بشروط:
      - من لا يرى المبالغ لا يرفض مستنداً له فاتورة (القرار قرارٌ بمبلغ).
      - فاتورةٌ عليها سدادٌ مقيَّد لا تُسقط — يُتراجَع عن السداد أوّلاً.
      - فاتورةٌ طُوبق عليها سطرُ كشفِ مورّد لا تُسقط بصمت.
      - والشهر المقفل لا يُكتب فيه.
    وما يُسقط يُكتب كاملاً في سجلّ التدقيق قبل حذفه.
  */
  type Outcome =
    | { kind: "NOT_PENDING" }
    | { kind: "FORBIDDEN" }
    | { kind: "PAID"; number: string; allocatedMinor: number }
    | { kind: "MATCHED"; number: string }
    | { kind: "DONE"; fileName: string; removed: number };

  let outcome: Outcome;
  try {
    outcome = await db.transaction(async (t): Promise<Outcome> => {
      const [doc] = await t
        .select({ id: documents.id, fileName: documents.fileName, status: documents.status })
        .from(documents)
        .where(eq(documents.id, documentId))
        .for("update")
        .limit(1);
      if (!doc || !(UNDECIDED as readonly string[]).includes(doc.status)) return { kind: "NOT_PENDING" };

      const linked = await t
        .select({
          id: invoices.id,
          number: invoices.invoiceNumber,
          supplierId: invoices.supplierId,
          totalMinor: invoices.totalMinor,
          periodMonth: invoices.periodMonth,
          invoiceDate: invoices.invoiceDate,
          allocatedMinor: sql<number>`coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = ${invoices}.id), 0)::bigint`,
          matchedLines: sql<number>`(select count(*) from statement_lines sl where sl.matched_invoice_id = ${invoices}.id)::int`,
        })
        .from(invoices)
        .where(eq(invoices.documentId, doc.id));

      if (linked.length > 0 && !can(user.role, "amounts:view")) return { kind: "FORBIDDEN" };
      const paid = linked.find((l) => Number(l.allocatedMinor) > 0);
      if (paid) return { kind: "PAID", number: paid.number, allocatedMinor: Number(paid.allocatedMinor) };
      const matched = linked.find((l) => Number(l.matchedLines) > 0);
      if (matched) return { kind: "MATCHED", number: matched.number };

      await assertMonthsOpen(t, linked.map((l) => l.periodMonth));

      const rows = await t
        .update(documents)
        .set({ status: "REJECTED" })
        .where(and(eq(documents.id, doc.id), inArray(documents.status, [...UNDECIDED])))
        .returning({ id: documents.id, fileName: documents.fileName });
      if (rows.length === 0) return { kind: "NOT_PENDING" };

      if (linked.length > 0) {
        await t.delete(invoices).where(eq(invoices.documentId, doc.id));
      }
      await t.delete(statements).where(eq(statements.documentId, doc.id));

      await recordAudit({
        actorId: user.id,
        action: "DOCUMENT_REJECTED",
        entityType: "document",
        entityId: rows[0].id,
        before: linked.length > 0
          ? {
              "فواتير أُسقطت معه": linked.map((l) => ({
                المعرّف: l.id,
                الرقم: l.number,
                المورّد: l.supplierId,
                الإجمالي: l.totalMinor,
                التاريخ: l.invoiceDate,
                الشهر: l.periodMonth,
              })),
            }
          : undefined,
        after: { الملف: rows[0].fileName, السبب: reason },
      }, t);
      return { kind: "DONE", fileName: rows[0].fileName, removed: linked.length };
    });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  switch (outcome.kind) {
    case "NOT_PENDING":
      return NextResponse.json({ error: "المستند ليس بانتظار قرار — ربما حُسم من نافذةٍ أخرى" }, { status: 409 });
    case "FORBIDDEN":
      return NextResponse.json({ error: "لهذا المستند فاتورة بمبلغ — رفضُه يحتاج صلاحية عرض المبالغ" }, { status: 403 });
    case "PAID":
      return NextResponse.json({
        error: `على الفاتورة ${outcome.number} سدادٌ مقيَّد (${formatRiyalsDisplay(outcome.allocatedMinor)}) — تراجع عن السداد أوّلاً ثمّ ارفض المستند`,
      }, { status: 409 });
    case "MATCHED":
      return NextResponse.json({
        error: `الفاتورة ${outcome.number} مطابَقةٌ في كشف مورّد — أعد مطابقة الكشف قبل رفض المستند`,
      }, { status: 409 });
    case "DONE":
      return NextResponse.json({
        ok: true,
        message: outcome.removed > 0
          ? "رُفض المستند وأُسقطت فاتورتُه من المستحقّ — وملفّه باقٍ في الدرايف كما هو"
          : "رُفض المستند — وملفّه باقٍ في الدرايف كما هو",
      });
  }
}
