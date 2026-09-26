/**
 * إعادة تسمية ملفّات الأرشيف إلى الصيغة القياسية.
 *
 * وهذه العمليّةُ الكتابيّةُ الوحيدة على الدرايف في النظام كلّه — وأوّلُ
 * قيدٍ في المشروع يمنعها «بلا طلب صريح من أحمد». وقد طلبها في ٧ سبتمبر
 * ٢٠٢٦: **إعادةُ تسميةٍ وحدها، على الصيغة الأساسية، لما خالفها.**
 *
 * فهي مقيَّدة بأربعة:
 *
 *   ١. **التسمية وحدها** — لا حذف، ولا نقل، ولا تغيير محتوى.
 *   ٢. **ما له سجلٌّ عندنا وحده** — الملفّ الذي لا نعرفه لا يُمسّ.
 *   ٣. **الاسم من المقيَّد لا من التخمين** — مورّدٌ وتاريخٌ وإجماليّ
 *      ورقمُ فاتورة، كلّها من القاعدة. وما نقص منه ما يُميّز لا
 *      يُقترَح له اسم، ويُعرَض سببُ امتناعه.
 *   ٤. **لا شيء بلا اختيار** — المعاينة تعرض الاسمين، والخادم لا
 *      يُعيد تسمية إلّا ما أرسل المتصفّح معرّفَه، ثمّ **يُعيد اشتقاق
 *      الاسم بنفسه** ولا يأخذه من المتصفّح.
 */
import { can } from "@/lib/permissions";
import { NextResponse } from "next/server";
import { documentHref } from "@/lib/document-labels";
import { guard, respondTo } from "@/services/guard";
import { DriveAuthExpiredError, driveForUser } from "@/lib/drive";
import { applyRenames } from "@/services/drive-rename.service";
import { canonicalName } from "@/lib/canonical-name";
import { loadNamedDocuments } from "@/services/drive-status.service";
import { recordAudit } from "@/lib/audit";
import { refreshTokenFor } from "@/services/drive.service";
import { DRIVE_READONLY_MESSAGE, driveWritesAllowed } from "@/lib/drive-readonly";

export const runtime = "nodejs";
export const maxDuration = 60;

/** حدُّ ما يُعاد تسميته في الطلب الواحد — والباقي في الذي يليه. */
const MAX_PER_CALL = 25;

interface Body {
  apply?: boolean;
  /** معرّفات ملفّات الدرايف المختارة — ولا شيء غيرها يُؤخَذ. */
  fileIds?: string[];
}

/** يجمع ما يُبنى به الاسم من الجداول التي تحمله. */
export async function POST(request: Request) {
  let user;
  try {
    /* الأرشيف يُكتَب فيه — فالصلاحية صلاحيةُ رفعٍ لا قراءة */
    user = await guard("drive-rename", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  const docs = await loadNamedDocuments();

  const proposals = docs
    .map((d) => ({ doc: d, verdict: canonicalName(d) }))
    .filter((p) => p.verdict.status !== "OK");

  const renameable = proposals.flatMap((p) =>
    p.verdict.status === "RENAME"
      ? [{ doc: p.doc, proposed: p.verdict.proposed, reason: p.verdict.reason }]
      : []);
  /*
    ── «لا يُبنى له اسم» كان طريقاً مسدوداً ──

    كانت القائمةُ تقول «لا رقم فاتورة مقيَّد له» وتقف. وهي **ليست
    عطباً في التسمية** — هي نقصٌ في بيانات الفاتورة نفسها، وموضعُ
    إصلاحه شاشةُ الفواتير. فصار لكلّ سطرٍ بابُه: من ضغطه وصل إلى
    الحقل الناقص وكتبه، ثمّ عاد فبُني الاسم.
  */
  const blocked = proposals.flatMap((p) =>
    p.verdict.status === "CANNOT"
      ? [{
          current: p.doc.fileName,
          reason: p.verdict.reason,
          /* المسار الذي يُصلَح فيه النقص — وما لا مسار له يُقال أنّه بلا مسار */
          /* ملفُّ المستند: فيه ما نقص بعينه، والحقلُ يُكتب في مكانه، وشرحُ ما قرّره النظام */
          fixHref: p.doc.documentId ? documentHref(p.doc.documentId, "fix") : null,
          /* عرضُ السعر والعقدُ لا صيغةَ لهما عمداً — لا شيء ناقصٌ فيهما */
          byDesign: !["TAX_INVOICE", "SIMPLIFIED_INVOICE", "STATEMENT"].includes(p.doc.kind),
        }]
      : []);

  /* ── معاينة ── */
  /*
    المعاينةُ تعمل في كلّ بيئة؛ والتنفيذ لا يقع إلّا في الإنتاج. فالدرايف
    لا يتفرّع كما تتفرّع القاعدة، وتسميةٌ من معاينةٍ تقع على الملفّ الذي
    يراه أحمد.
  */
  if (body.apply === true && !driveWritesAllowed(process.env)) {
    return NextResponse.json({ ok: false, error: DRIVE_READONLY_MESSAGE }, { status: 403 });
  }

  if (body.apply !== true) {
    return NextResponse.json({
      ok: true,
      applied: false,
      summary: {
        archived: docs.length,
        onStandard: docs.length - proposals.length,
        toRename: renameable.length,
        cannot: blocked.length,
      },
      proposals: renameable.slice(0, 200).map((p) => ({
        fileId: p.doc.driveFileId,
        current: p.doc.fileName,
        proposed: p.proposed,
        reason: p.reason,
        /* ينتظر المراجعة: اسمُه من قراءةٍ لم تُحسَم — يُسمّى آلياً حين يُعتمَد */
        pending: p.doc.pending,
      })),
      cannot: blocked.slice(0, 40),
    });
  }

  /* ── التنفيذ ── */
  if (!can(user.role, "supplier:edit")) {
    return NextResponse.json({ error: "تسمية ملفّات الأرشيف تحتاج صلاحية «تعديل المورّدين والأصناف» — اطلبها من مالك الحساب" }, { status: 403 });
  }
  const chosen = new Set(Array.isArray(body.fileIds) ? body.fileIds : []);
  if (chosen.size === 0) {
    return NextResponse.json({ error: "لم تُختَر ملفّات" }, { status: 400 });
  }

  /* وضعُ التجربة لا يحمل تفويضاً — لا يُسمّى ملفٌّ في الأرشيف الحقيقيّ منه */
  const token = await refreshTokenFor(user.id);

  if (!token) {
    return NextResponse.json(
      { error: "لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف." },
      { status: 428 },
    );
  }
  const drive = driveForUser(token);

  /*
    الخادم يعيد اشتقاق الاسم ولا يأخذه من المتصفّح.

    فمن أرسل معرّفاً واسماً من عنده لا يكتب في الأرشيف ما يشاء — يُكتَب
    ما تقوله بيانات المستند وحدها.
  */
  const mine = renameable.filter((p) => chosen.has(p.doc.driveFileId));
  const targets = mine.slice(0, MAX_PER_CALL);

  const { done, failed, authExpired } = await applyRenames(
    drive,
    targets.map((t) => ({ driveFileId: t.doc.driveFileId, fileName: t.doc.fileName, proposed: t.proposed })),
  );

  if (done.length > 0) {
    await recordAudit({
      actorId: user.id,
      action: "DRIVE_FILE_RENAMED",
      entityType: "drive",
      entityId: "rename",
      after: {
        الفعل: "إعادة تسمية في الدرايف إلى الصيغة القياسية",
        عدد: done.length,
        الملفّات: done.map((d) => `${d.from} ← ${d.to}`),
        فشل: failed.map((f) => `${f.from}: ${f.error}`),
      },
    });
  }
  if (authExpired && done.length === 0) {
    return NextResponse.json({ error: new DriveAuthExpiredError().message }, { status: 428 });
  }


  return NextResponse.json({
    ok: true,
    applied: true,
    renamed: done.length,
    failed: failed.length,
    remaining: mine.length - targets.length,
    details: done,
    errors: failed,
    /*
      الصفرُ له معنيان، ويجب أن يُفرَّقا.

      «أُعيدت تسمية ٠ ملفّاً» تُقرأ فشلاً — وقد تكون نجاحاً تامّاً وقع
      في نداءٍ سابق فلم يبقَ شيء. وقد وقع ذلك: سُمّيت ثلاثة ملفّات
      فعلاً، ثمّ ضُغط الزرّ ثانيةً فقيل «٠» — فحسب صاحب العمل أنّ
      التسمية لا تعمل، وهي تعمل.
    */
    message: failed.length > 0
      ? `أُعيدت تسمية ${done.length} · وتعذّر ${failed.length}: ${failed[0]?.error.slice(0, 80)}`
      : done.length === 0
        ? "لا شيء يحتاج تسمية — أسماؤها موحَّدة أصلاً"
        : `أُعيدت تسمية ${done.length} ملفّاً`
          + (mine.length > targets.length ? ` · بقي ${mine.length - targets.length} — اضغط ثانيةً` : ""),
  });
}
