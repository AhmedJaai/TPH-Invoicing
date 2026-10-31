"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, FileSearch, MessageSquarePlus, RotateCcw, Send, Sparkles, Target, Trash2, X } from "lucide-react";
import { messageForStatus, NETWORK_ERROR, postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { ReadySubmit, toast } from "./ui-client";
import { AdvisorText } from "./advisor-text";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  verified: Record<string, string>;
  tools: { name: string; label: string }[];
}
export interface ThreadItem { id: string; title: string; updatedLabel: string }
export interface PlanItem { id: string; title: string; detail: string | null; horizonDays: number; metric: string | null; status: "OPEN" | "DONE" | "DROPPED" }

type Event =
  | { type: "thread"; id: string; title: string }
  | { type: "step"; label: string }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

/**
 * مساحةُ المستشار: المحادثةُ في الوسط، ومحادثاتُه السابقة وخطّتُه بجانبها.
 *
 * السؤالُ يُرسَل فيُبثّ ما يفعله وهو يعمل («يراجع ربح سبتمبر»)؛ ودورٌ قد يطول دقيقتين
 * لا يُترك صامتاً. وإن تعذّر الجوابُ بقي السؤالُ في الحقل ليُعاد — لا يضيع ما كُتب.
 * والصفحةُ تمرّره بمفتاح المحادثة: الانتقالُ إلى غيرها يبدأ حالاً جديدة لا يُزامَن بأثر.
 */
export function AdvisorWorkspace({
  threadId: initialThreadId,
  messages: initialMessages,
  threads,
  plan,
  starters,
}: {
  threadId: string | null;
  messages: ChatMessage[];
  threads: ThreadItem[];
  plan: PlanItem[];
  starters: readonly string[];
}) {
  const router = useRouter();
  const [threadId, setThreadId] = useState(initialThreadId);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  /* معرّفٌ محلّيّ للسؤال المتفائل — عدّادٌ لا ساعة (الرسمُ نقيّ) */
  const seq = useRef(0);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, steps.length]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setError(null);
    setSteps([]);
    setInput("");
    const optimistic: ChatMessage = { id: `local-${++seq.current}`, role: "user", content: question, verified: {}, tools: [] };
    setMessages((m) => [...m, optimistic]);
    let current = threadId;
    let failed: string | null = null;
    try {
      const res = await fetch("/api/advisor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId: current, message: question }) });
      if (!res.ok || !res.body) {
        const raw = await res.text().catch(() => "");
        let msg: string | null = null;
        try { const j = JSON.parse(raw) as { error?: unknown }; msg = typeof j.error === "string" ? j.error : null; } catch { /* ليس JSON */ }
        failed = msg ?? messageForStatus(res.status);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;
        while (!finished) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let e: Event;
            try { e = JSON.parse(line) as Event; } catch { continue; }
            if (e.type === "thread") current = e.id;
            if (e.type === "step") setSteps((s) => (s.at(-1) === e.label ? s : [...s, e.label]));
            if (e.type === "done") { setMessages((m) => [...m, e.message]); finished = true; }
            if (e.type === "error") { failed = e.error; finished = true; }
          }
        }
        if (!finished && !failed) failed = "انقطع الجواب قبل أن يكتمل. أعد إرسال سؤالك.";
      }
    } catch {
      failed = NETWORK_ERROR;
    }
    setBusy(false);
    setSteps([]);
    if (failed) {
      /* السؤالُ لم يُحفَظ: يعود إلى الحقل ولا يبقى في المحادثة كأنّه سُئل */
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(question);
      setError(failed);
      return;
    }
    setThreadId(current);
    if (current && current !== initialThreadId) router.replace(`/finance/advisor?t=${current}`, { scroll: false });
    else router.refresh();
  }

  async function planStatus(id: string, status: PlanItem["status"]) {
    const r = await postJson<{ message?: string }>("/api/advisor/manage", { kind: "plan", id, status });
    if (!r.ok) { toast({ tone: "danger", title: "تعذّر تحديث البند", body: r.error }); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُدّث البند" });
    router.refresh();
  }

  async function removeThread(id: string) {
    if (!window.confirm("تُحذف هذه المحادثة برسائلها، وتبقى بنود الخطة التي كُتبت منها. أتحذفها؟")) return;
    const r = await postJson("/api/advisor/manage", { kind: "delete-thread", id });
    if (!r.ok) { toast({ tone: "danger", title: "تعذّر الحذف", body: r.error }); return; }
    toast({ tone: "ok", title: "حُذفت المحادثة" });
    if (id === threadId) router.replace("/finance/advisor");
    else router.refresh();
  }

  const open = plan.filter((p) => p.status === "OPEN");
  const closed = plan.filter((p) => p.status !== "OPEN");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section aria-label="المحادثة" className="flex min-h-[60vh] min-w-0 flex-col rounded-2xl border border-line bg-raised shadow-raised">
        <div className="flex-1 space-y-6 p-4 sm:p-6">
          {messages.length === 0 && !busy && (
            <div className="mx-auto max-w-xl py-6 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-accent-soft text-accent"><Sparkles className="h-6 w-6" strokeWidth={1.75} aria-hidden /></span>
              <p className="mt-4 font-display text-2xl text-ink">أهلاً أحمد، أنا مستشارك.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">أعرف المقهى من دفاتره: المبيعات والتكاليف والرواتب والنقد وسرعة الخدمة. اسألني عن أي قرار، أو اطلب دراسة أو خطة، وسأكتب معك ما نتفق عليه وأتابعه.</p>
              <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-2 text-start sm:grid-cols-2">
                {starters.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="min-h-11 rounded-xl border border-line bg-sunken/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft transition-colors hover:border-accent-line hover:bg-accent-soft/40">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-sm bg-accent px-4 py-2.5 text-[15px] leading-7 text-accent-ink">{m.content}</p>
              </div>
            ) : (
              <article key={m.id} className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent"><Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /></span>
                  المستشار
                  {m.tools.length > 0 && (
                    <details className="font-normal">
                      <summary className="cursor-pointer select-none hover:text-ink">راجع {m.tools.length === 1 ? "مصدراً واحداً" : `${m.tools.length} مصادر`} قبل أن يجيب</summary>
                      <ul className="mt-1 space-y-0.5 ps-4 text-[11px]">
                        {[...new Set(m.tools.map((t) => t.label))].map((l) => <li key={l} className="list-disc">{l}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                <AdvisorText content={m.content} verified={m.verified} />
              </article>
            )
          ))}

          {busy && (
            <div role="status" aria-live="polite" className="rounded-xl border border-line-soft bg-sunken/40 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-ink"><CircleDashed className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />المستشار يعمل على سؤالك</p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {steps.map((s, i) => (
                  <li key={`${s}-${i}`} className="flex items-center gap-1.5">
                    {i === steps.length - 1 ? <FileSearch className="h-3.5 w-3.5 text-accent" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-hidden />}
                    {s}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted">قد يأخذ دقيقة أو اثنتين حين يراجع أكثر من مصدر.</p>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="sticky bottom-0 border-t border-line bg-raised p-3 sm:p-4"
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
        >
          {error && (
            <p role="alert" className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
              {error}
              <button type="button" aria-label="أغلق الرسالة" className="shrink-0" onClick={() => setError(null)}><X className="h-4 w-4" aria-hidden /></button>
            </p>
          )}
          <div className="flex items-end gap-2">
            <label htmlFor="advisor-input" className="sr-only">سؤالك للمستشار</label>
            <textarea
              id="advisor-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
              rows={2}
              maxLength={4000}
              placeholder="اسأل عن قرار، أو اطلب دراسة أو خطة…"
              className="min-h-12 flex-1 resize-y rounded-xl border border-line-input bg-raised px-3 py-2.5 text-[15px] leading-7 focus:border-accent focus:outline-none"
              disabled={busy}
            />
            <ReadySubmit ready={input.trim().length > 0} missing="اكتب سؤالك أولاً" busy={busy} size="lg">
              <Send className="h-4 w-4" aria-hidden /><span className="sr-only sm:not-sr-only">أرسل</span>
            </ReadySubmit>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            الرقم تحته خط متصل من دفاترك (قف عليه لترى مصدره)، والمتقطع مرجع عام للصناعة، والمنقّط معرفة عامة أو تقدير. مشورة تحليلية لا تغني عن محاسب مرخّص في الإقرار والزكاة.
          </p>
        </form>
      </section>

      <aside className="space-y-5" aria-label="المحادثات والخطة">
        <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-bold"><Target className="h-4 w-4 text-accent" aria-hidden />الخطة</h2>
            <span className="text-[11px] text-muted">{open.length === 0 ? "لا بنود مفتوحة" : `${open.length} مفتوح`}</span>
          </div>
          {plan.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-muted">حين تتفق مع المستشار على خطوة، يكتبها هنا بأفقها ومؤشرها ويسألك عنها لاحقاً.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...open, ...closed].map((p) => (
                <li key={p.id} className={`rounded-xl border border-line-soft p-3 ${p.status !== "OPEN" ? "opacity-60" : ""}`}>
                  <p className={`text-[13px] font-bold leading-relaxed ${p.status === "DONE" ? "line-through" : ""}`}>{p.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{p.horizonDays} يوماً{p.metric ? ` · يُقاس بـ${p.metric}` : ""}</p>
                  {p.detail && <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">{p.detail}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.status === "OPEN" ? (
                      <>
                        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => void planStatus(p.id, "DONE")}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />أنجزته</button>
                        <button type="button" className={buttonClass("quiet", "sm")} onClick={() => void planStatus(p.id, "DROPPED")}>اتركه</button>
                      </>
                    ) : (
                      <button type="button" className={buttonClass("quiet", "sm")} onClick={() => void planStatus(p.id, "OPEN")}><RotateCcw className="h-3.5 w-3.5" aria-hidden />أعده مفتوحاً</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">المحادثات</h2>
            <Link href="/finance/advisor?new=1" className={buttonClass("secondary", "sm")}><MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />جديدة</Link>
          </div>
          {threads.length === 0 ? (
            <p className="mt-2 text-xs text-muted">لا محادثات بعد.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {threads.map((t) => (
                <li key={t.id} className="group flex items-center gap-1">
                  <Link
                    href={`/finance/advisor?t=${t.id}`}
                    aria-current={t.id === threadId ? "page" : undefined}
                    className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-hover ${t.id === threadId ? "bg-accent-soft/60 font-bold" : ""}`}
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="text-[10px] font-normal text-muted">{t.updatedLabel}</span>
                  </Link>
                  <button type="button" aria-label={`احذف المحادثة «${t.title}»`} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-danger" onClick={() => void removeThread(t.id)}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
