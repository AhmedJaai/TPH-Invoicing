/**
 * المستشار — محادثةٌ تُحفَظ، ودورٌ يفتح فيه الدفاتر قبل أن يجيب.
 *
 * الدورُ الواحد: رسالةُ صاحب المقهى تُكتب، ثمّ يُعطى النموذجُ هويّتَه (`persona.ts`) وإحاطةً
 * بالمقهى (مؤشّراتُ كلّ شهر وبنودُ الخطّة) وتاريخَ المحادثة وأدواتِه، فيطلب ما يحتاج —
 * جولاتٍ معدودة — ثمّ يجيب. وكلُّ حقيقةٍ رآها تُجمَع، فيُوسَم كلُّ رقمٍ في جوابه: من
 * دفاترك أو عامّ (`verify.ts`). والفشلُ لا يترك نصفَ دور: رسالتُه تُمحى ويقال السبب.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { advisorMessages, advisorPlanItems, advisorThreads } from "@/db/schema";
import { callDeepseek, type DeepseekMessage } from "@/lib/ai/deepseek";
import { isDeepseekConfigured } from "@/lib/ai/models";
import { advisorSystemPrompt } from "@/lib/advisor/persona";
import { verifiedNumbers } from "@/lib/advisor/verify";
import type { Fact } from "@/lib/finance/reading";
import { formatDay, formatMonth, isoDay, todayInRiyadh } from "@/lib/riyadh-time";
import type { Role } from "@/lib/permissions";
import { advisorToolsFor, lastFinishedMonth, monthsOverviewFacts, renderFacts, runAdvisorTool, type ToolContext } from "./advisor-tools.service";

/** جولاتُ الأدوات قبل أن يُطلب الجوابُ بلا أدوات. */
const MAX_TOOL_ROUNDS = 4;
/** ما يُعاد من تاريخ المحادثة — الأحدثُ أولى. */
const HISTORY = 16;

export interface ThreadSummary { id: string; title: string; updatedAt: Date }
export interface AdvisorMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  verified: Record<string, string>;
  tools: { name: string; label: string }[];
  status: "PENDING" | "DONE" | "FAILED";
  steps: string[];
  error: string | null;
  createdAt: Date;
}
export interface PlanItemView {
  id: string; title: string; detail: string | null; horizonDays: number; metric: string | null;
  status: "OPEN" | "DONE" | "DROPPED"; createdAt: Date;
}

export async function listThreads(limit = 30): Promise<ThreadSummary[]> {
  return db.select({ id: advisorThreads.id, title: advisorThreads.title, updatedAt: advisorThreads.updatedAt })
    .from(advisorThreads).orderBy(desc(advisorThreads.updatedAt)).limit(limit);
}

export async function loadThreadMessages(threadId: string): Promise<AdvisorMessageView[]> {
  const rows = await db.select().from(advisorMessages).where(eq(advisorMessages.threadId, threadId)).orderBy(asc(advisorMessages.createdAt));
  return rows.map((r) => {
    const stale = r.status === "PENDING" && Date.now() - r.createdAt.getTime() > STALE_PENDING_MS;
    return {
      id: r.id, role: r.role, content: r.content, verified: r.verified ?? {}, tools: r.tools ?? [],
      status: stale ? "FAILED" as const : r.status, steps: r.steps ?? [],
      error: stale ? "انقطع العمل على هذا الجواب قبل أن يكتمل. أعد المحاولة." : r.error, createdAt: r.createdAt,
    };
  });
}

export async function listPlan(): Promise<PlanItemView[]> {
  return db.select({
    id: advisorPlanItems.id, title: advisorPlanItems.title, detail: advisorPlanItems.detail, horizonDays: advisorPlanItems.horizonDays,
    metric: advisorPlanItems.metric, status: advisorPlanItems.status, createdAt: advisorPlanItems.createdAt,
  }).from(advisorPlanItems).orderBy(asc(advisorPlanItems.status), desc(advisorPlanItems.createdAt)).limit(60);
}

export async function setPlanStatus(id: string, status: "OPEN" | "DONE" | "DROPPED"): Promise<boolean> {
  const rows = await db.update(advisorPlanItems).set({ status, updatedAt: new Date() }).where(eq(advisorPlanItems.id, id)).returning({ id: advisorPlanItems.id });
  return rows.length > 0;
}

export async function deleteThread(id: string): Promise<boolean> {
  const rows = await db.delete(advisorThreads).where(eq(advisorThreads.id, id)).returning({ id: advisorThreads.id });
  return rows.length > 0;
}

/** إحاطةُ الدور: ما يعرفه موظّفٌ عن مقهاه قبل أن يُسأل. */
async function briefing(): Promise<{ text: string; facts: Fact[] }> {
  const [months, plan] = await Promise.all([monthsOverviewFacts(), listPlan()]);
  const open = plan.filter((p) => p.status === "OPEN");
  const planText = open.length === 0
    ? "لا بنود مفتوحة في الخطّة."
    : open.map((p) => `- [${p.id}] ${p.title} (${p.horizonDays} يوماً، منذ ${formatDay(isoDay(p.createdAt))})${p.metric ? ` — يُقاس بـ: ${p.metric}` : ""}`).join("\n");
  return {
    text: `# إحاطة: مؤشّرات كلّ شهر (من الدفاتر)\n${renderFacts(months)}\n\n# الخطّة المفتوحة\n${planText}`,
    facts: months,
  };
}

/** جوابٌ «يعمل» أقدمُ من هذا انقطع (قُتل المسار أو سقط الخادم) — يُقال تعذّر لا يُنتظر أبداً. */
export const STALE_PENDING_MS = 6 * 60_000;

export interface TurnInput {
  threadId: string | null;
  message: string;
  user: { id: string; role: Role };
  canSeePayroll: boolean;
}

export type StartOutcome =
  | { ok: true; threadId: string; title: string; userMessageId: string; pendingId: string }
  | { ok: false; status: number; error: string };

/**
 * يبدأ الدور: يكتب السؤالَ وجواباً «يعمل» ويعود فوراً — والعملُ نفسُه في `runAdvisorJob`
 * خارج الطلب (`after`)، فلا يقطعه خروجُ صاحب المقهى من الصفحة.
 * ودورٌ واحدٌ في المحادثة في كلّ لحظة: سؤالان معاً يتجاوب فيهما جوابان على تاريخٍ ناقص.
 */
export async function startAdvisorTurn(input: TurnInput): Promise<StartOutcome> {
  if (!isDeepseekConfigured()) return { ok: false, status: 503, error: "المستشار يحتاج مفتاح DeepSeek، وهو غير مضبوط في هذه البيئة." };
  const text = input.message.trim();
  let threadId = input.threadId;
  let title = "";
  if (threadId) {
    const [t] = await db.select({ id: advisorThreads.id, title: advisorThreads.title }).from(advisorThreads).where(eq(advisorThreads.id, threadId)).limit(1);
    if (!t) return { ok: false, status: 404, error: "هذه المحادثة لم تعد موجودة. ابدأ محادثة جديدة." };
    title = t.title;
    const [busy] = await db.select({ id: advisorMessages.id, createdAt: advisorMessages.createdAt }).from(advisorMessages)
      .where(and(eq(advisorMessages.threadId, threadId), eq(advisorMessages.status, "PENDING"))).limit(1);
    if (busy && Date.now() - busy.createdAt.getTime() < STALE_PENDING_MS) {
      return { ok: false, status: 409, error: "المستشار ما زال يعمل على سؤالك السابق في هذه المحادثة. انتظر جوابه أو ابدأ محادثة جديدة." };
    }
  } else {
    title = text.length > 70 ? `${text.slice(0, 68)}…` : text;
    const [t] = await db.insert(advisorThreads).values({ title, createdById: input.user.id }).returning({ id: advisorThreads.id });
    threadId = t.id;
  }
  const rows = await db.transaction(async (t) => {
    const [u] = await t.insert(advisorMessages).values({ threadId: threadId!, role: "user", content: text }).returning({ id: advisorMessages.id });
    const [a] = await t.insert(advisorMessages).values({ threadId: threadId!, role: "assistant", content: "", status: "PENDING", steps: [] }).returning({ id: advisorMessages.id });
    await t.update(advisorThreads).set({ updatedAt: new Date() }).where(eq(advisorThreads.id, threadId!));
    return { userId: u.id, pendingId: a.id };
  });
  return { ok: true, threadId, title, userMessageId: rows.userId, pendingId: rows.pendingId };
}

export interface PendingView {
  id: string;
  status: "PENDING" | "DONE" | "FAILED";
  steps: string[];
  error: string | null;
}

/** حالُ جوابٍ ينتظر — و«يعمل» أقدمُ من حدّه يُقال انقطع. */
export async function loadAnswerStatus(id: string): Promise<PendingView | null> {
  const [m] = await db.select({ id: advisorMessages.id, status: advisorMessages.status, steps: advisorMessages.steps, error: advisorMessages.error, createdAt: advisorMessages.createdAt })
    .from(advisorMessages).where(and(eq(advisorMessages.id, id), eq(advisorMessages.role, "assistant"))).limit(1);
  if (!m) return null;
  const stale = m.status === "PENDING" && Date.now() - m.createdAt.getTime() > STALE_PENDING_MS;
  return {
    id: m.id,
    status: stale ? "FAILED" : m.status,
    steps: m.steps ?? [],
    error: stale ? "انقطع العمل على هذا الجواب قبل أن يكتمل. أعد إرسال سؤالك." : m.error,
  };
}

/** العملُ نفسُه — خارج الطلب. يكتب خطواته في صفّ الجواب، ثمّ الجوابَ أو سببَ تعذّره. */
export async function runAdvisorJob(input: TurnInput & { threadId: string; pendingId: string }): Promise<void> {
  const steps: string[] = [];
  const step = async (label: string) => {
    if (steps.at(-1) === label) return;
    steps.push(label);
    await db.update(advisorMessages).set({ steps: [...steps] }).where(eq(advisorMessages.id, input.pendingId)).catch(() => {});
  };
  try {
    await step("يقرأ إحاطة المقهى");
    const ctx: ToolContext = { userId: input.user.id, role: input.user.role, canSeePayroll: input.canSeePayroll, threadId: input.threadId };
    const [brief, history] = await Promise.all([briefing(), loadThreadMessages(input.threadId)]);
    const facts: Fact[] = [...brief.facts];
    const used: { name: string; label: string }[] = [];
    /* التاريخُ ما تمّ وحده: الجوابُ الذي ينتظر أو تعذّر لا يُعطى للنموذج */
    const done = history.filter((m) => m.id !== input.pendingId && (m.role === "user" || m.status === "DONE"));
    const messages: DeepseekMessage[] = [
      { role: "system", content: advisorSystemPrompt({ today: todayInRiyadh(), lastFinishedMonth: formatMonth(lastFinishedMonth()), canSeePayroll: input.canSeePayroll }) },
      { role: "system", content: brief.text },
      ...done.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content }) as DeepseekMessage),
    ];
    const tools = advisorToolsFor(ctx);

    let answer = "";
    let model = "";
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      await step(round === 0 ? "يفكّر في سؤالك" : "يربط ما وجده");
      const last = round === MAX_TOOL_ROUNDS;
      const r = await callDeepseek({
        task: "REASONING",
        messages: last ? [...messages, { role: "system", content: "انتهت جولات المراجعة. أجب الآن بما وجدت، وقل ما لم تستطع معرفته." }] : messages,
        tools: last ? undefined : tools,
        maxTokens: 12_000,
        temperature: 0.4,
        timeoutMs: 120_000,
      });
      if (!r.ok) throw new AdvisorFailed(r.reason);
      model = r.model;
      if (r.toolCalls.length === 0) { answer = r.text; break; }
      messages.push({ role: "assistant", content: r.text, toolCalls: r.toolCalls, reasoning: r.reasoning });
      const results = await Promise.all(r.toolCalls.map(async (c) => ({ c, out: await runAdvisorTool(c.name, c.arguments, ctx) })));
      for (const { c, out } of results) {
        await step(out.label);
        facts.push(...out.facts);
        used.push({ name: c.name, label: out.label });
        messages.push({ role: "tool", toolCallId: c.id, content: renderFacts(out.facts) || "- لا شيء" });
      }
    }
    if (!answer.trim()) throw new AdvisorFailed("لم يكتب المستشار جواباً");
    await db.update(advisorMessages).set({
      content: answer.slice(0, 40_000), verified: verifiedNumbers(answer, facts), tools: used, model, status: "DONE", steps: [...steps], error: null,
    }).where(eq(advisorMessages.id, input.pendingId));
    await db.update(advisorThreads).set({ updatedAt: new Date() }).where(eq(advisorThreads.id, input.threadId));
  } catch (e) {
    const reason = e instanceof AdvisorFailed ? e.message : "تعذّر إكمال الجواب";
    if (!(e instanceof AdvisorFailed)) console.error("[advisor]", (e as Error).message);
    /* السؤالُ يبقى في المحادثة، والجوابُ «تعذّر» بسببه — يُعاد بضغطة لا يُكتب من جديد */
    await db.update(advisorMessages).set({ status: "FAILED", error: `${reason}.`.slice(0, 500), steps: [...steps] })
      .where(eq(advisorMessages.id, input.pendingId)).catch(() => {});
  }
}

/** «أعد المحاولة»: الجوابُ الذي تعذّر يعود «يعمل» على السؤال نفسه. */
export async function retryAnswer(pendingId: string): Promise<{ threadId: string } | null> {
  const rows = await db.update(advisorMessages).set({ status: "PENDING", error: null, steps: [], createdAt: new Date() })
    .where(and(eq(advisorMessages.id, pendingId), eq(advisorMessages.status, "FAILED")))
    .returning({ threadId: advisorMessages.threadId });
  return rows[0] ?? null;
}

class AdvisorFailed extends Error {}
