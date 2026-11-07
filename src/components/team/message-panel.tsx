"use client";

/**
 * «رسالة للإدارة» في «TPH Team» — اقتراحٌ أو شكوى يصل صاحبَ المقهى في «يحتاج قرارك»، ويرى
 * الموظّفُ ردَّه هنا. والمرسَلةُ بلا اسم لا يُحفظ معها اسمُه، فلا تظهر في قائمته ولا يصله ردّ.
 *
 * المسودّةُ تُحفظ في الجوال وحده حتى تُرسل — راحةٌ لا حقيقة.
 */
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, CheckCircle2, Clock3, EyeOff, Lightbulb, MessageCircleWarning, MessageSquareText, Reply, Send } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { ReadySubmit } from "@/components/ui-client";
import type { TeamMessageKind } from "@/db/schema";

export interface MyMessageView {
  id: string;
  kind: TeamMessageKind;
  body: string;
  createdAt: string;
  read: boolean;
  reply: string | null;
  repliedAt: string | null;
  closed: boolean;
}

const KINDS: readonly { id: TeamMessageKind; label: string; hint: string; Icon: typeof Lightbulb }[] = [
  { id: "SUGGESTION", label: "اقتراح", hint: "فكرة تحسّن العمل أو المكان أو الخدمة", Icon: Lightbulb },
  { id: "COMPLAINT", label: "شكوى", hint: "مشكلة في العمل أو المكان أو مع أحد", Icon: MessageCircleWarning },
  { id: "OTHER", label: "أخرى", hint: "طلب أو سؤال أو أي شيء آخر", Icon: MessageSquareText },
];
const KIND_LABEL: Record<TeamMessageKind, string> = { SUGGESTION: "اقتراح", COMPLAINT: "شكوى", OTHER: "رسالة" };

const MIN = 3, MAX = 2000;
const DRAFT_KEY = "tph-team.message-draft";

const noSubscribe = () => () => {};
function readDraft(): string {
  try { return window.localStorage.getItem(DRAFT_KEY) ?? ""; } catch { return ""; }
}

const when = (iso: string) => new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "Asia/Riyadh" });

export function MessagePanel({ token, messages }: { token: string; messages: MyMessageView[] }) {
  const router = useRouter();
  const [kind, setKind] = useState<TeamMessageKind>("SUGGESTION");
  /* المسودّةُ المحفوظة أوّلَ مرّة، ثمّ ما يكتبه — والخادمُ لا يعرف الجوال فيبدأ فارغاً */
  const draft = useSyncExternalStore(noSubscribe, readDraft, () => "");
  const [typed, setBody] = useState<string | null>(null);
  const body = typed ?? draft;
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ anonymous: boolean } | null>(null);

  function edit(v: string) {
    setBody(v);
    setSent(null);
    try { if (v.trim()) window.localStorage.setItem(DRAFT_KEY, v); else window.localStorage.removeItem(DRAFT_KEY); } catch { /* تُكتب ولا تُحفظ */ }
  }

  const length = body.trim().length;
  const ready = length >= MIN && length <= MAX;

  async function send() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ id: string }>("/api/team/message", { token, kind, body, anonymous });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setSent({ anonymous });
    setBody("");
    setAnonymous(false);
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* لا شيء */ }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <form className="rounded-2xl border border-line bg-raised p-4 shadow-raised" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <h2 className="text-base font-bold">رسالة للإدارة</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">تصل لصاحب المقهى مباشرة. اقتراحك يُقرأ، وشكواك تُعالَج.</p>

        <div role="radiogroup" aria-label="نوع الرسالة" className="mt-4 grid grid-cols-3 gap-2">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)}
              className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-bold transition-colors ${kind === k.id ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink-soft hover:bg-hover"}`}>
              <k.Icon className="h-5 w-5" aria-hidden />{k.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted">{KINDS.find((k) => k.id === kind)?.hint}</p>

        <label htmlFor="team-message" className="mt-3 block text-xs font-bold text-ink-soft">رسالتك</label>
        <textarea id="team-message" value={body} onChange={(e) => edit(e.target.value)} rows={6} maxLength={MAX + 50}
          placeholder={kind === "COMPLAINT" ? "اكتب ما حدث ومتى، وما الذي تقترحه لحلّه." : kind === "SUGGESTION" ? "اكتب فكرتك، ولماذا ستفيد." : "اكتب ما تريد قوله."}
          className="mt-1.5 block w-full rounded-xl border border-line-input bg-surface px-3 py-2.5 text-base leading-relaxed focus:border-accent focus:outline-none" />
        <p className={`mt-1 text-end text-[11px] ${length > MAX ? "font-bold text-danger" : "text-muted"}`}><span className="nums">{length}</span> / <span className="nums">{MAX}</span></p>

        <label className="mt-2 flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-sm">
          <input type="checkbox" className="mt-1" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-bold"><EyeOff className="h-4 w-4 text-muted" aria-hidden />أرسلها دون اسمي</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">لا يُحفظ اسمك معها أبداً، فلن تظهر في رسائلك هنا ولن يصلك رد عليها.</span>
          </span>
        </label>

        {error && <p role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-sm font-bold text-danger">{error}</p>}
        {sent && (
          <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-ok/25 bg-ok-bg px-3 py-2 text-sm font-bold text-ok">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {sent.anonymous ? "وصلت رسالتك دون اسمك. شكراً لك." : "وصلت رسالتك. سترى رد الإدارة هنا."}
          </p>
        )}

        <div className="mt-4 flex flex-col items-center gap-1.5">
          <ReadySubmit ready={ready} busy={busy} size="lg" className="w-full"
            missing={length > MAX ? `الرسالة أطول من ${MAX} حرف. اختصرها.` : "اكتب رسالتك أولاً."}>
            <Send className="h-4 w-4" aria-hidden />{busy ? "تُرسل…" : "أرسل"}
          </ReadySubmit>
        </div>
      </form>

      <section aria-label="رسائلك">
        <h2 className="text-xs font-bold text-ink-soft">رسائلك</h2>
        {messages.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">لم ترسل رسالة باسمك بعد.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="rounded-xl border border-line bg-raised p-3.5">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-bold text-ink-soft">{KIND_LABEL[m.kind]} · {when(m.createdAt)}</span>
                  <Status m={m} />
                </div>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
                {m.reply && (
                  <div className="mt-2.5 rounded-lg border-s-4 border-accent bg-accent-soft/40 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-accent"><Reply className="h-3.5 w-3.5" aria-hidden />رد الإدارة{m.repliedAt && ` · ${when(m.repliedAt)}`}</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{m.reply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Status({ m }: { m: MyMessageView }) {
  if (m.closed) return <span className="flex items-center gap-1 font-bold text-ok"><CheckCheck className="h-3.5 w-3.5" aria-hidden />عولجت</span>;
  if (m.reply) return <span className="flex items-center gap-1 font-bold text-accent"><Reply className="h-3.5 w-3.5" aria-hidden />رُدّ عليها</span>;
  if (m.read) return <span className="flex items-center gap-1 text-ink-soft"><CheckCheck className="h-3.5 w-3.5" aria-hidden />قُرئت</span>;
  return <span className="flex items-center gap-1 text-muted"><Clock3 className="h-3.5 w-3.5" aria-hidden />وصلت</span>;
}
