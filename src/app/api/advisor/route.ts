/**
 * المستشار — السؤالُ يُكتب ويُردّ فوراً، والجوابُ عملٌ في الخلفية (`after`).
 *
 * كان الجوابُ يُبثّ في الطلب نفسه، فإن خرج صاحبُ المقهى من الصفحة انقطع الاتّصال وتوقّف
 * المستشار ومُحي سؤالُه (أحمد: «لازم أقعد أنتظره»). فصار: POST يكتب السؤالَ وجواباً «يعمل»
 * ويعود، والعملُ يُكمَل بعد الردّ حتى عمر المسار (٣٠٠ ثانية) ولو أُغلقت الصفحة؛ وGET يقول
 * حالَ الجواب وخطواته لمن ينتظر أو يعود. و«أعد المحاولة» يعيد ما تعذّر على السؤال نفسه.
 */
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { withDeadline } from "@/lib/ai/deadline";
import { readJson } from "@/lib/request-body";
import { can } from "@/lib/permissions";
import { guard, respondTo } from "@/services/guard";
import { loadAnswerStatus, retryAnswer, runAdvisorJob, startAdvisorTurn } from "@/services/advisor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** يقف العملُ قبل عمر المسار بمهلةٍ معلَنة — فيُكتب «تعذّر» بسببه لا يُقتل صامتاً. */
const JOB_BUDGET_MS = 280_000;

const Body = z.union([
  z.object({
    threadId: z.string().trim().min(1).max(64).nullable().optional(),
    message: z.string().trim().min(1, "اكتب سؤالك").max(4000, "السؤال أطول من 4000 حرف"),
  }).strict(),
  z.object({ retry: z.string().trim().min(1).max(64) }).strict(),
]);

export async function POST(request: Request) {
  try {
    /* يكتب محادثةً ويصرف من رصيد الذكاء — بصلاحيّة كتابة المالية لا بالنظر */
    const user = await guard("advisor", "month:close");
    const read = await readJson(request, Body);
    if (!read.ok) return read.response;
    const body = read.body;
    const canSeePayroll = can(user.role, "payroll:view");

    if ("retry" in body) {
      const again = await retryAnswer(body.retry);
      if (!again) return NextResponse.json({ error: "هذا الجواب لم يتعذّر، أو لم يعد موجوداً. حدّث الصفحة" }, { status: 409 });
      after(() => withDeadline(JOB_BUDGET_MS, () => runAdvisorJob({
        threadId: again.threadId, pendingId: body.retry, message: "", user: { id: user.id, role: user.role }, canSeePayroll,
      })));
      return NextResponse.json({ ok: true, threadId: again.threadId, pendingId: body.retry });
    }

    const started = await startAdvisorTurn({ threadId: body.threadId ?? null, message: body.message, user: { id: user.id, role: user.role }, canSeePayroll });
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status });
    after(() => withDeadline(JOB_BUDGET_MS, () => runAdvisorJob({
      threadId: started.threadId, pendingId: started.pendingId, message: body.message, user: { id: user.id, role: user.role }, canSeePayroll,
    })));
    return NextResponse.json({ ok: true, threadId: started.threadId, title: started.title, userMessageId: started.userMessageId, pendingId: started.pendingId });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}

/** حالُ جوابٍ ينتظر: «يعمل» بخطواته، أو تمّ، أو تعذّر بسببه. */
export async function GET(request: Request) {
  try {
    await guard("advisor-status", "month:close");
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return NextResponse.json({ error: "معرّف الجواب غير صالح" }, { status: 400 });
    const status = await loadAnswerStatus(id);
    if (!status) return NextResponse.json({ error: "هذا الجواب لم يعد موجوداً" }, { status: 404 });
    return NextResponse.json({ ok: true, ...status });
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }
}
