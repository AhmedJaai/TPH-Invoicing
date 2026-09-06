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
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, statements, suppliers } from "@/db/schema";
import { guard, respondTo } from "@/services/guard";
import { driveForUser, renameFile } from "@/lib/drive";
import { canonicalName, type NamedDocument } from "@/lib/canonical-name";
import { recordAudit } from "@/lib/audit";

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
async function load(): Promise<NamedDocument[]> {
  const rows = await db
    .select({
      driveFileId: documents.driveFileId,
      fileName: documents.fileName,
      kind: documents.kind,
      slug: suppliers.slug,
      invoiceDate: invoices.invoiceDate,
      invoiceTotal: invoices.totalMinor,
      invoiceNumber: invoices.invoiceNumber,
      statementEnd: statements.periodEnd,
      statementTotal: statements.closingBalanceMinor,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .leftJoin(invoices, eq(invoices.documentId, documents.id))
    .leftJoin(statements, eq(statements.documentId, documents.id))
    .where(eq(documents.status, "ARCHIVED"));

  return rows
    .filter((r): r is typeof r & { driveFileId: string } => Boolean(r.driveFileId))
    .map((r) => ({
      driveFileId: r.driveFileId,
      fileName: r.fileName,
      kind: r.kind,
      slug: r.slug,
      date: (r.invoiceDate ?? r.statementEnd)?.toISOString().slice(0, 10) ?? null,
      totalMinor: r.invoiceTotal ?? r.statementTotal ?? null,
      invoiceNumber: r.invoiceNumber ?? null,
    }));
}

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
  const docs = await load();

  const proposals = docs
    .map((d) => ({ doc: d, verdict: canonicalName(d) }))
    .filter((p) => p.verdict.status !== "OK");

  const renameable = proposals.flatMap((p) =>
    p.verdict.status === "RENAME"
      ? [{ doc: p.doc, proposed: p.verdict.proposed, reason: p.verdict.reason }]
      : []);
  const blocked = proposals.flatMap((p) =>
    p.verdict.status === "CANNOT"
      ? [{ current: p.doc.fileName, reason: p.verdict.reason }]
      : []);

  /* ── معاينة ── */
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
      })),
      cannot: blocked.slice(0, 40),
    });
  }

  /* ── التنفيذ ── */
  const chosen = new Set(Array.isArray(body.fileIds) ? body.fileIds : []);
  if (chosen.size === 0) {
    return NextResponse.json({ error: "لم تُختَر ملفّات" }, { status: 400 });
  }

  const [tokenRow] = await db
    .select({ token: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.provider, "google")))
    .limit(1);

  if (!tokenRow?.token) {
    return NextResponse.json(
      { error: "لا يوجد تفويض درايف لحسابك. سجّل الخروج ثم الدخول ووافق على صلاحية الدرايف." },
      { status: 428 },
    );
  }
  const drive = driveForUser(tokenRow.token);

  /*
    الخادم يعيد اشتقاق الاسم ولا يأخذه من المتصفّح.

    فمن أرسل معرّفاً واسماً من عنده لا يكتب في الأرشيف ما يشاء — يُكتَب
    ما تقوله بيانات المستند وحدها.
  */
  const mine = renameable.filter((p) => chosen.has(p.doc.driveFileId));
  const targets = mine.slice(0, MAX_PER_CALL);

  const done: { from: string; to: string }[] = [];
  const failed: { from: string; error: string }[] = [];

  for (const t of targets) {
    try {
      await renameFile(drive, t.doc.driveFileId, t.proposed);
      await db
        .update(documents)
        .set({ fileName: t.proposed })
        .where(eq(documents.driveFileId, t.doc.driveFileId));
      done.push({ from: t.doc.fileName, to: t.proposed });
    } catch (e) {
      /* فشلُ ملفٍّ لا يوقف البقيّة — ويُعلَن ولا يُبتلَع */
      failed.push({ from: t.doc.fileName, error: (e as Error).message });
    }
  }

  if (done.length > 0) {
    await recordAudit({
      actorId: user.id,
      action: "DOCUMENT_ARCHIVED",
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

  return NextResponse.json({
    ok: true,
    applied: true,
    renamed: done.length,
    failed: failed.length,
    remaining: mine.length - targets.length,
    details: done,
    errors: failed,
    message: failed.length === 0
      ? `أُعيدت تسمية ${done.length} ملفّاً`
        + (mine.length > targets.length ? ` · بقي ${mine.length - targets.length} — اضغط ثانيةً` : "")
      : `أُعيدت تسمية ${done.length} · وتعذّر ${failed.length}`,
  });
}
