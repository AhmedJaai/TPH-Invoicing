"use client";

/**
 * عند صاحب المقهى: يكتب بطاقةَ المرجع ويعدّلها، ويقرّ طلبَ الموظّف أو يردّه بسبب.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { WEEKDAY_LABEL } from "@/lib/payroll/attendance";
import type { TeamBoardKind } from "@/db/schema";
import { buttonClass, fieldClass } from "../ui-tokens";
import { ReadySubmit, toast } from "../ui-client";

const field = fieldClass("md", false);
const label = "block text-xs font-bold text-ink-soft";

const PLACEHOLDER: Record<TeamBoardKind, { title: string; body: string }> = {
  ANNOUNCEMENT: { title: "بكرة توريد الحليب الساعة 8", body: "استلموه وتأكدوا من التاريخ." },
  BEAN: { title: "إثيوبيا — جوجي", body: "محمصة …\nالنكهات: ياسمين، خوخ، شاي أسود\nيُقدّم: V60 أو إسبريسو" },
  RECIPE: { title: "لاتيه — كبير", body: "دبل شوت 36 جم\nحليب 240 مل\n\n1. …\n2. …" },
  GRIND: { title: "إسبريسو — إثيوبيا", body: "الطحنة: 2.4\nالمدخل: 18 جم\nالمخرج: 36 جم\nالوقت: 27–30 ثانية" },
  CLEANING_DAILY: { title: "إغلاق: تنظيف المكينة", body: "Backflush بالماء ثم المنظف…" },
  CLEANING_WEEKLY: { title: "تنظيف المطحنة", body: "…" },
};

export function BoardEditor({ kind, item, onDone }: { kind: TeamBoardKind; item?: { id: string; title: string; body: string; weekday: number | null; sort: number }; onDone?: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.body ?? "");
  const [weekday, setWeekday] = useState<number | null>(item?.weekday ?? (kind === "CLEANING_WEEKLY" ? 0 : null));
  const [sort, setSort] = useState(String(item?.sort ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = title.trim().length >= 2;
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!ready || busy) return;
      setBusy(true); setError(null);
      const r = await postJson<{ message?: string }>("/api/payroll/team", { action: "board-save", id: item?.id ?? null, kind, title, body, weekday: kind === "CLEANING_WEEKLY" ? weekday : null, sort: Number(sort) || 0 });
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      toast({ tone: "ok", title: r.data.message ?? "حُفظ" });
      if (!item) { setTitle(""); setBody(""); }
      onDone?.();
      router.refresh();
    }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <label className={label}>العنوان<input className={`${field} mt-1.5`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={PLACEHOLDER[kind].title} /></label>
        <label className={label}>الترتيب<input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
      </div>
      {kind === "CLEANING_WEEKLY" && (
        <fieldset>
          <legend className={label}>اليوم</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {WEEKDAY_LABEL.map((d, i) => (
              <button key={d} type="button" aria-pressed={weekday === i} onClick={() => setWeekday(i)}
                className={`min-h-11 rounded-lg border px-3 text-xs font-bold sm:min-h-9 ${weekday === i ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-soft hover:bg-hover"}`}>{d}</button>
            ))}
          </div>
        </fieldset>
      )}
      <label className={label}>التفاصيل <span className="font-normal text-muted">(كل سطر يظهر كما تكتبه)</span>
        <textarea className={`${field} mt-1.5 min-h-32 py-2 leading-relaxed`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} placeholder={PLACEHOLDER[kind].body} />
      </label>
      {error && <p role="alert" className="text-xs font-bold text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <ReadySubmit ready={ready} busy={busy} size="sm" missing="اكتب العنوان أولاً.">{item ? <><Check className="h-3.5 w-3.5" aria-hidden />احفظ</> : <><Plus className="h-3.5 w-3.5" aria-hidden />أضف</>}</ReadySubmit>
        {onDone && <button type="button" className={buttonClass("quiet", "sm")} onClick={onDone}>ألغِ</button>}
      </div>
    </form>
  );
}

export function BoardRow({ kind, item }: { kind: TeamBoardKind; item: { id: string; title: string; body: string; weekday: number | null; sort: number } }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  if (editing) return <li className="px-4 py-3"><BoardEditor kind={kind} item={item} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-sm font-bold">{item.title}{item.weekday !== null && <span className="ms-2 text-[11px] text-muted">{WEEKDAY_LABEL[item.weekday]}</span>}</p>
        {item.body && <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-ink-soft">{item.body}</p>}
      </div>
      <span className="flex gap-1">
        <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden />عدّل</button>
        <button type="button" className={buttonClass("quiet", "sm")} onClick={async () => {
          const r = await postJson<{ message?: string }>("/api/payroll/team", { action: "board-archive", id: item.id });
          if (!r.ok) { toast({ tone: "danger", title: r.error }); return; }
          toast({ tone: "ok", title: "أُخرجت من المرجع", undo: { run: async () => { const u = await postJson("/api/payroll/team", { action: "board-restore", id: item.id }); if (u.ok) router.refresh(); return u.ok; } } });
          router.refresh();
        }}><X className="h-3.5 w-3.5" aria-hidden />أخرجها</button>
      </span>
    </li>
  );
}

/** يقرّ الطلبَ أو يردّه — والردُّ بسببٍ يراه الموظّف. */
export function DecideButtons({ id, approveLabel }: { id: string; approveLabel: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    const r = await postJson<{ message?: string }>("/api/payroll/team", { action: "decide", id, approve, note: note || undefined });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: r.data.message ?? "قُرّر" });
    router.refresh();
  }
  return (
    <div className="basis-full space-y-2">
      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${fieldClass("sm", false)} max-w-xs`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="السبب (يراه الموظف)" aria-label="سبب الرفض" autoFocus />
          <button type="button" className={buttonClass("danger", "sm")} disabled={busy} aria-busy={busy} onClick={() => void decide(false)}>ارفض</button>
          <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setRejecting(false)}>ألغِ</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass("primary", "sm")} disabled={busy} aria-busy={busy} onClick={() => void decide(true)}><Check className="h-3.5 w-3.5" aria-hidden />{approveLabel}</button>
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setRejecting(true)}><X className="h-3.5 w-3.5" aria-hidden />ارفض</button>
        </div>
      )}
      {error && <p role="alert" className="text-[11px] font-bold text-danger">{error}</p>}
    </div>
  );
}
