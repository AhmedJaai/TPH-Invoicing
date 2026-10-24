/**
 * الاستدراك — «أكّد المؤهَّل» بيدٍ، والخلفيّ من القشرة، والتشغيلُ المجدول. تنفيذٌ واحد.
 *
 * كان في مسار `/api/document-status` وحده، فنُقل إلى هنا كي يمرّ به التشغيلُ المجدول
 * (`/api/cron/drive`) بالقاعدة نفسها: الإيقافُ بيد صاحبه، وبصمةُ ما تغيّر (`isDue`)،
 * والصلاحيّاتُ نفسها (`amounts:view` للاعتماد، `bank:edit` للربط، `payment:approve` للدمج).
 *
 * والخلفيُّ (من القشرة أو من الجدول) يأخذ عقداً (`backlog-sweep-lease`): جهازان أو
 * جهازٌ وتشغيلٌ مجدول في اللحظة نفسها — الثاني لا يعمل. والضغطُ بيدٍ يجري دائماً.
 */
import { randomUUID } from "node:crypto";
import type { Role } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { driveForUser } from "@/lib/drive";
import { driveWritesAllowed } from "@/lib/drive-readonly";
import { DOCUMENT, FILE, INVOICE, PAYMENT, TRANSACTION, countNoun } from "@/lib/arabic";
import type { AutoWorkItem } from "@/lib/auto-work";
import { acquireLease, backlogFingerprint, isDue, markRan, releaseLease } from "./job-state.service";
import { processDocumentBacklog } from "./document-review.service";
import { isAutoPaused } from "./auto-process.service";
import { refreshTokenFor } from "./drive.service";
import { linkExactHandPayments, mergeExactEchoes } from "./account-review.service";

/** حدُّ ما يُترك الاستدراكُ الخلفيّ بلا تشغيلٍ وإن لم يتغيّر شيء — لسياسات الأيّام */
const BACKLOG_MAX_AGE_MS = 6 * 60 * 60_000;
const SWEEP_LEASE = "backlog-sweep-lease";
const SWEEP_LEASE_MS = 70_000;

export interface SweepActor { id: string; role: Role }

export interface SweepCounts {
  recorded: number;
  approved: number;
  renamed: { from: string; to: string }[];
  reread: number;
  notes: string[];
  handLinked: number;
  done: AutoWorkItem[];
}

export type SweepOutcome =
  | { kind: "forbidden"; error: string }
  /** لم يجرِ: موقوفٌ بيد صاحبه، أو لا جديد منذ آخر مرّة، أو استدراكٌ آخر يجري الآن. */
  | { kind: "skipped"; reason: "paused" | "unchanged" | "busy"; message: string }
  | { kind: "ran"; message: string; counts: SweepCounts };

export async function runBacklogSweep(actor: SweepActor, opts: { background: boolean }): Promise<SweepOutcome> {
  if (!can(actor.role, "amounts:view")) {
    return { kind: "forbidden", error: "الاعتماد يحتاج إلى صلاحية عرض المبالغ" };
  }
  /*
    موقوفٌ بيد صاحبه: الخلفيُّ لا يقيّد ولا يعتمد حتى يشغّله. والضغطُ بيدٍ يجري —
    من ضغط «أكّد المؤهَّل» طلب العملَ بعينه.
  */
  if (opts.background && await isAutoPaused()) {
    return { kind: "skipped", reason: "paused", message: "العمل الآلي موقوف" };
  }
  /*
    الخلفيُّ لا يُعاد ما لم تتغيّر بصمةُ ما يعمل عليه أو تمضِ ستُّ ساعات — كان
    يجري كلَّ عشر دقائق لكلّ جهاز ولو لم يتغيّر صفّ (`job-state.service.ts`).
  */
  if (opts.background && !(await isDue("backlog", await backlogFingerprint(), BACKLOG_MAX_AGE_MS))) {
    return { kind: "skipped", reason: "unchanged", message: "لا جديد منذ آخر مراجعة آلية" };
  }
  const holder = randomUUID();
  if (opts.background && !(await acquireLease(SWEEP_LEASE, holder, SWEEP_LEASE_MS))) {
    return { kind: "skipped", reason: "busy", message: "مراجعة آلية أخرى تجري الآن" };
  }
  try {
    return { kind: "ran", ...await sweep(actor) };
  } finally {
    if (opts.background) await releaseLease(SWEEP_LEASE, holder).catch(() => undefined);
  }
}

async function sweep(actor: SweepActor): Promise<{ message: string; counts: SweepCounts }> {
  let drive = null;
  if (driveWritesAllowed(process.env)) {
    const token = await refreshTokenFor(actor.id).catch(() => null);
    if (token) drive = driveForUser(token);
  }
  const r = await processDocumentBacklog(actor.id, drive);
  /*
    حوالةٌ في طابور البنك وسدادُها قيّده صاحبُ العمل بيد بالمبلغ نفسه — تُربط
    هنا أيضاً لا عند الاستيراد وحده: ما استُورد قبل وجود الربط (مختبرات القهوة
    ٦٣٨) كان يبقى في «يحتاج قرارك» حتى يُضغط زرّ. والسياسةُ سياسةُ الاستيراد.
  */
  const handLinked = can(actor.role, "bank:edit") ? await linkExactHandPayments(actor.id, r.notes) : 0;
  /* والدفعةُ التي قُيِّدت مرّتين بالمبلغ نفسه — حوالةٌ وإقرارٌ عنها — تُدمج بالسياسة نفسها */
  const echoesMerged = can(actor.role, "payment:approve") ? await mergeExactEchoes(actor.id, r.notes) : 0;
  const parts = [
    echoesMerged > 0 ? `دُمجت ${countNoun(echoesMerged, PAYMENT)} سُجّلت مرتين` : null,
    handLinked > 0 ? `رُبطت ${countNoun(handLinked, TRANSACTION)} بنكية بسداد سجّلته يدوياً` : null,
    r.recorded > 0 ? `سُجّلت من القراءة المحفوظة: ${countNoun(r.recorded, INVOICE)}` : null,
    r.approved > 0 ? `اعتُمد ${countNoun(r.approved, DOCUMENT)}` : null,
    r.renamed.length > 0 ? `وسُمّي ${countNoun(r.renamed.length, FILE)}` : null,
    r.reread > 0 ? `وأُعيدت قراءة ${countNoun(r.reread, INVOICE)}` : null,
    r.notes.length > 0 ? `وتعذّر ${r.notes.length}: ${r.notes[0]}` : null,
  ].filter(Boolean);
  const message = parts.length === 0 ? "لا يوجد الآن مستند تتوفر فيه الشروط" : parts.join(" · ");
  await markRan("backlog", await backlogFingerprint());
  return { message, counts: { ...r, handLinked: handLinked + echoesMerged } };
}
