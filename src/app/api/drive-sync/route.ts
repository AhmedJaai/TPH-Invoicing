/**
 * المزامنة التدريجية مع الدرايف — بابُ الشاشة.
 *
 * التنفيذُ كلُّه في `services/drive-sync.service.ts`، يمرّ به هذا البابُ بجلسة صاحبه
 * والتشغيلُ المجدول (`/api/cron/drive`) باسم المالك — بالعقد نفسه.
 *
 * والمزامنةُ الخلفيّة من القشرة (`background`) تُترَك إن نجح تشغيلٌ مجدول قريباً: هو
 * قرأ الدرايف بتفويض المالك، فلا يعيد كلُّ جهازٍ ما فرغ منه. والضغطُ بيدٍ يجري دائماً.
 */
import { NextResponse } from "next/server";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { withDeadline } from "@/lib/ai/deadline";
import { runAsSystemIf } from "@/lib/actor-context";
import { DriveSyncBody, runDriveSync } from "@/services/drive-sync.service";
import { BROWSER_SYNC_EVERY_MS, scheduledRanRecently } from "@/services/cron.service";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request) {
  let user;
  try {
    user = await guard("drive-sync", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const parsedBody = await readJson(request, DriveSyncBody, { emptyOk: true });
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  if (body.background === true && await scheduledRanRecently("drive", BROWSER_SYNC_EVERY_MS)) {
    return NextResponse.json({ ok: true, scheduled: true, summary: { created: 0, truncated: false }, backlog: { done: [] } });
  }
  return runAsSystemIf(body.background === true, () => runDriveSync(user, body));
}

/* النداءات تحت عمر المسار — تقف بمهلةٍ معلَنة قبل أن تقتلها المنصّة */
export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}
