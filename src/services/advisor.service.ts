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
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, verified: r.verified ?? {}, tools: r.tools ?? [], createdAt: r.createdAt }));
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

export type TurnEvent =
  | { type: "thread"; id: string; title: string }
  | { type: "step"; label: string }
  | { type: "done"; message: AdvisorMessageView }
  | { type: "error"; error: string };

export interface TurnInput {
  threadId: string | null;
  message: string;
  user: { id: string; role: Role };
  canSeePayroll: boolean;
}

/** دورٌ واحد — يُبلغ خطواته وهو يعمل، ويحفظ السؤالَ وجوابَه معاً أو لا شيء. */
export async function runAdvisorTurn(input: TurnInput, emit: (e: TurnEvent) => void): Promise<void> {
  if (!isDeepseekConfigured()) {
    emit({ type: "error", error: "المستشار يحتاج مفتاح DeepSeek، وهو غير مضبوط في هذه البيئة." });
    return;
  }
  const text = input.message.trim();
  let threadId = input.threadId;
  let created = false;
  if (threadId) {
    const [t] = await db.select({ id: advisorThreads.id }).from(advisorThreads).where(eq(advisorThreads.id, threadId)).limit(1);
    if (!t) { emit({ type: "error", error: "هذه المحادثة لم تعد موجودة. ابدأ محادثة جديدة." }); return; }
  } else {
    const title = text.length > 70 ? `${text.slice(0, 68)}…` : text;
    const [t] = await db.insert(advisorThreads).values({ title, createdById: input.user.id }).returning({ id: advisorThreads.id });
    threadId = t.id;
    created = true;
    emit({ type: "thread", id: threadId, title });
  }
  const [userRow] = await db.insert(advisorMessages).values({ threadId, role: "user", content: text }).returning({ id: advisorMessages.id });

  const undo = async () => {
    await db.delete(advisorMessages).where(and(eq(advisorMessages.id, userRow.id), eq(advisorMessages.threadId, threadId!)));
    if (created) await db.delete(advisorThreads).where(eq(advisorThreads.id, threadId!));
  };

  try {
    emit({ type: "step", label: "يقرأ إحاطة المقهى" });
    const ctx: ToolContext = { userId: input.user.id, role: input.user.role, canSeePayroll: input.canSeePayroll, threadId };
    const [brief, history] = await Promise.all([briefing(), loadThreadMessages(threadId)]);
    const facts: Fact[] = [...brief.facts];
    const used: { name: string; label: string }[] = [];
    const messages: DeepseekMessage[] = [
      { role: "system", content: advisorSystemPrompt({ today: todayInRiyadh(), lastFinishedMonth: formatMonth(lastFinishedMonth()), canSeePayroll: input.canSeePayroll }) },
      { role: "system", content: brief.text },
      ...history.slice(-HISTORY).map((m) => ({ role: m.role, content: m.content }) as DeepseekMessage),
    ];
    const tools = advisorToolsFor(ctx);

    let answer = "";
    let model = "";
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      emit({ type: "step", label: round === 0 ? "يفكّر في سؤالك" : "يربط ما وجده" });
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
      const results = await Promise.all(r.toolCalls.map(async (c) => {
        const out = await runAdvisorTool(c.name, c.arguments, ctx);
        emit({ type: "step", label: out.label });
        return { c, out };
      }));
      for (const { c, out } of results) {
        facts.push(...out.facts);
        used.push({ name: c.name, label: out.label });
        messages.push({ role: "tool", toolCallId: c.id, content: renderFacts(out.facts) || "- لا شيء" });
      }
    }
    if (!answer.trim()) throw new AdvisorFailed("لم يكتب المستشار جواباً");

    const verified = verifiedNumbers(answer, facts);
    const [row] = await db.insert(advisorMessages).values({
      threadId, role: "assistant", content: answer.slice(0, 40_000), verified, tools: used, model,
    }).returning({ id: advisorMessages.id, createdAt: advisorMessages.createdAt });
    await db.update(advisorThreads).set({ updatedAt: new Date() }).where(eq(advisorThreads.id, threadId));
    emit({ type: "done", message: { id: row.id, role: "assistant", content: answer, verified, tools: used, createdAt: row.createdAt } });
  } catch (e) {
    await undo().catch(() => {});
    const reason = e instanceof AdvisorFailed ? e.message : "تعذّر إكمال الجواب";
    if (!(e instanceof AdvisorFailed)) console.error("[advisor]", (e as Error).message);
    emit({ type: "error", error: `${reason}. لم يُحفظ سؤالك، فأعد إرساله.` });
  }
}

class AdvisorFailed extends Error {}
