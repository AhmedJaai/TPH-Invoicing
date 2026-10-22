/**
 * صورةُ فريقٍ تُهيَّأ للمراجعة بمعرّفها — بلا تنزيلٍ ولا رفع.
 *
 *   POST { id } → ما يُرجعه `/api/analyze` نفسُه
 *
 * كانت شاشةُ الرفع تُنزّل الصورةَ من القاعدة ثمّ ترفعها إلى `/api/analyze` لتُقرأ
 * قراءتُها المحفوظة (وتُصغَّر الكبيرةُ قبل الرفع فتتغيّر بصمتُها وتُقرأ بالذكاء ثانيةً).
 * والبايتاتُ هنا من القاعدة نفسها، والقواعدُ قواعدُ `analyzeForReview` بعينها.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { withDeadline } from "@/lib/ai/deadline";
import { readJson } from "@/lib/request-body";
import { guard, respondTo } from "@/services/guard";
import { analyzeForReview } from "@/services/analyze.service";
import { loadCaptureFile } from "@/services/capture.service";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

export async function POST(request: Request) {
  return withDeadline(55_000, () => handle(request));
}

async function handle(request: Request) {
  let user;
  try {
    user = await guard("capture-analyze", "document:upload");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const file = await loadCaptureFile(read.body.id);
  if (!file) return NextResponse.json({ error: "هذه الصورة لم تعد تنتظر: اعتُمدت أو رُفضت. حدّث الصفحة" }, { status: 404 });
  const ext = file.mimeType === "application/pdf" ? "pdf" : "jpg";
  const out = await analyzeForReview(file.data, file.mimeType, `من-${file.sender}.${ext}`, user);
  return NextResponse.json(out.body, { status: out.status });
}
