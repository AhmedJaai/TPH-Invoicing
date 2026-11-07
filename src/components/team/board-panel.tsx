"use client";

/**
 * «المرجع» في TPH Team — ما يرجع إليه الموظّف وقتَ الحاجة: البنُّ الحالي، والوصفات، والطحنات،
 * والنظافةُ اليوميّة والأسبوعيّة. قراءةٌ لا مهامّ: لا «تم» ولا متابعة. وعلى كلّ بطاقة «اقترح تعديلاً»
 * يصل الإدارةَ لتعتمده أو ترفضه.
 */
import { useState } from "react";
import { Bean, BookOpen, ChevronDown, CupSoda, Pencil, Search, Sparkles, SprayCan } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { WEEKDAY_LABEL } from "@/lib/payroll/attendance";
import { ReadySubmit } from "@/components/ui-client";
import type { TeamBoardKind } from "@/db/schema";

export interface BoardCard { id: string; kind: TeamBoardKind; title: string; body: string; weekday: number | null }

const SECTIONS: readonly { kind: TeamBoardKind; title: string; Icon: typeof Bean; empty: string }[] = [
  { kind: "BEAN", title: "البن الحالي", Icon: Bean, empty: "لم يُكتب البن الحالي بعد." },
  { kind: "RECIPE", title: "الوصفات", Icon: CupSoda, empty: "لم تُكتب وصفات بعد." },
  { kind: "GRIND", title: "الطحنات", Icon: Sparkles, empty: "لم تُكتب الطحنات بعد." },
  { kind: "CLEANING_DAILY", title: "النظافة اليومية", Icon: SprayCan, empty: "لم تُكتب النظافة اليومية بعد." },
  { kind: "CLEANING_WEEKLY", title: "النظافة الأسبوعية", Icon: SprayCan, empty: "لم تُكتب النظافة الأسبوعية بعد." },
];

export function BoardPanel({ token, cards, todayWeekday, pendingIds }: { token: string; cards: BoardCard[]; todayWeekday: number; pendingIds: readonly string[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim();
  const match = (c: BoardCard) => !needle || c.title.includes(needle) || c.body.includes(needle);
  const shown = cards.filter((c) => c.kind !== "ANNOUNCEMENT" && match(c));

  if (cards.filter((c) => c.kind !== "ANNOUNCEMENT").length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-5 py-10 text-center">
        <BookOpen className="mx-auto h-8 w-8 text-muted" aria-hidden />
        <p className="mt-3 text-sm font-bold">المرجع فارغ الآن</p>
        <p className="mt-1 text-xs text-muted">تكتب الإدارة هنا الوصفات والطحنات والنظافة، وتظهر لك فور كتابتها.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <label className="relative block">
        <span className="sr-only">ابحث في المرجع</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث: لاتيه، V60، المكينة…"
          className="min-h-12 w-full rounded-xl border border-line-input bg-raised ps-9 pe-3 text-base focus:border-accent focus:outline-none" />
      </label>
      {SECTIONS.map((s) => {
        let items = shown.filter((c) => c.kind === s.kind);
        if (s.kind === "CLEANING_WEEKLY") items = [...items].sort((a, b) => ((a.weekday ?? 0) - todayWeekday + 7) % 7 - ((b.weekday ?? 0) - todayWeekday + 7) % 7);
        if (items.length === 0 && needle) return null;
        return (
          <section key={s.kind} aria-label={s.title}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold"><s.Icon className="h-4 w-4 text-accent" aria-hidden />{s.title}</h2>
            {items.length === 0 ? <p className="text-xs text-muted">{s.empty}</p> : (
              <ul className="space-y-2">
                {items.map((c) => <Card key={c.id} token={token} card={c} today={c.weekday === todayWeekday} pending={pendingIds.includes(c.id)} />)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Card({ token, card, today, pending: initiallyPending }: { token: string; card: BoardCard; today: boolean; pending: boolean }) {
  const [open, setOpen] = useState(card.kind === "BEAN");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(card.body);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(initiallyPending);
  const changed = body.trim() !== card.body.trim() && body.trim().length >= 2;

  async function propose() {
    if (busy || !changed) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ id: string }>("/api/team/request", { action: "create", token, request: { kind: "BOARD_EDIT", boardId: card.id, proposedBody: body, note } });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEditing(false);
    setPending(true);
  }

  return (
    <li className="rounded-xl border border-line bg-raised">
      <button type="button" onClick={() => setOpen((x) => !x)} aria-expanded={open} className="flex min-h-12 w-full items-center gap-2 px-4 py-2.5 text-start">
        <span className="min-w-0 flex-1 text-sm font-bold">
          {card.title}
          {card.kind === "CLEANING_WEEKLY" && card.weekday !== null && <span className={`ms-2 text-[11px] font-bold ${today ? "text-accent" : "text-muted"}`}>{today ? "اليوم" : WEEKDAY_LABEL[card.weekday]}</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          {editing ? (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void propose(); }}>
              <label className="block text-xs font-bold text-ink-soft" htmlFor={`p-${card.id}`}>عدّل النص كما تراه صحيحاً</label>
              <textarea id={`p-${card.id}`} value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(5, body.split("\n").length + 1))}
                className="block w-full rounded-lg border border-line-input bg-surface px-3 py-2 text-base leading-relaxed focus:border-accent focus:outline-none" />
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="لماذا؟ (اختياري)" aria-label="سبب الاقتراح"
                className="min-h-11 w-full rounded-lg border border-line-input bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
              {error && <p role="alert" className="text-xs font-bold text-danger">{error}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <ReadySubmit ready={changed} busy={busy} size="sm" missing="غيّر شيئاً في النص أولاً.">{busy ? "يُرسل…" : "أرسل الاقتراح"}</ReadySubmit>
                <button type="button" className="min-h-11 rounded-lg px-3 text-xs font-bold text-ink-soft hover:bg-hover sm:min-h-9" onClick={() => { setEditing(false); setBody(card.body); setError(null); }}>ألغِ</button>
              </div>
            </form>
          ) : (
            <>
              <p className="whitespace-pre-line text-sm leading-relaxed">{card.body || <span className="text-muted">لا تفاصيل.</span>}</p>
              {card.kind !== "CLEANING_DAILY" && card.kind !== "CLEANING_WEEKLY" && (
                pending
                  ? <p className="mt-3 text-[11px] font-bold text-accent">اقتراحك وصل للإدارة، وينتظر قرارها.</p>
                  : <button type="button" onClick={() => setEditing(true)} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-bold text-ink-soft hover:bg-hover sm:min-h-9">
                      <Pencil className="h-3.5 w-3.5" aria-hidden />اقترح تعديلاً
                    </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
