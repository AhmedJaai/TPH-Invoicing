/**
 * المستشار — رسالةٌ واحدة، وجوابُها يُبثّ خطواتٍ (NDJSON) وهو يعمل.
 *
 * الدورُ قد يأخذ دقيقةً أو اثنتين: يفتح الدفاتر بأدواته ثمّ يفكّر. فلا يُترك صاحبُ المقهى
 * أمام زرٍّ صامت — كلُّ خطوةٍ سطر («يراجع ربح سبتمبر»)، ثمّ الجوابُ أو سببُ تعذّره.
 * والمسارُ يعلن عمرَه: ٣٠٠ ثانية للمسار، والدورُ يقف قبلها بمهلةٍ معلَنة.
 */
import { z } from "zod";
import { withDeadline } from "@/lib/ai/deadline";
import { readJson } from "@/lib/request-body";
import { can } from "@/lib/permissions";
import { guard, respondTo } from "@/services/guard";
import { runAdvisorTurn, type TurnEvent } from "@/services/advisor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  threadId: z.string().trim().min(1).max(64).nullable().optional(),
  message: z.string().trim().min(1, "اكتب سؤالك").max(4000, "السؤال أطول من 4000 حرف"),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    /* يكتب محادثةً ويصرف من رصيد الذكاء — بصلاحيّة كتابة المالية لا بالنظر */
    user = await guard("advisor", "month:close");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
  const read = await readJson(request, Body);
  if (!read.ok) return read.response;
  const body = read.body;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: TurnEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await withDeadline(285_000, () => runAdvisorTurn({
          threadId: body.threadId ?? null,
          message: body.message,
          user: { id: user.id, role: user.role },
          canSeePayroll: can(user.role, "payroll:view"),
        }, emit));
      } catch (e) {
        console.error("[advisor] route:", (e as Error).message);
        emit({ type: "error", error: "تعذّر إكمال الجواب. أعد إرسال سؤالك." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
