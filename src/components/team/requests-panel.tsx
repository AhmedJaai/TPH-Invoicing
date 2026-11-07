"use client";

/**
 * «طلباتي» في TPH Team — رسالةٌ للإدارة، وطلبُ إجازة، وتبديلُ راحةٍ أو وردية مع زميل، وتبليغٌ عن تالف.
 * كلُّها تصل صاحبَ المقهى فيقرّها أو يردّها، ويرى الموظّفُ قرارَه هنا. لا يُنفَّذ شيءٌ قبل إقراره.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, CheckCircle2, Clock3, MessageSquareText, Repeat2, Trash2, XCircle } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { ReadySubmit } from "@/components/ui-client";
import { MessagePanel, type MyMessageView } from "./message-panel";
import type { TeamRequestKind, TeamRequestStatus } from "@/db/schema";

export interface MyRequestView {
  id: string;
  kind: TeamRequestKind;
  status: TeamRequestStatus;
  boardTitle: string | null;
  fromDay: string | null;
  toDay: string | null;
  withEmployeeName: string | null;
  productName: string | null;
  quantity: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface StockOption { id: string; name: string; unit: string; unitLabel: string }

type Mode = "message" | "leave" | "swap" | "waste";
const MODES: readonly { id: Mode; label: string; Icon: typeof CalendarOff }[] = [
  { id: "message", label: "رسالة", Icon: MessageSquareText },
  { id: "leave", label: "إجازة", Icon: CalendarOff },
  { id: "swap", label: "تبديل", Icon: Repeat2 },
  { id: "waste", label: "تالف", Icon: Trash2 },
];
const REASONS = [["SPILLED", "انسكب"], ["DAMAGED", "انكسر أو تلف"], ["EXPIRED", "انتهت صلاحيته"], ["FAILED_PREP", "تحضير فشل"], ["OTHER", "سبب آخر"]] as const;

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const field = "min-h-12 w-full rounded-xl border border-line-input bg-surface px-3 text-base focus:border-accent focus:outline-none";
const lbl = "block text-xs font-bold text-ink-soft";

export function RequestsPanel({ token, today, messages, requests, mates, stock }: {
  token: string; today: string; messages: MyMessageView[]; requests: MyRequestView[];
  mates: readonly { id: string; name: string }[]; stock: readonly StockOption[];
}) {
  const [mode, setMode] = useState<Mode>("message");
  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="نوع الطلب" className="grid grid-cols-4 gap-1.5 rounded-2xl border border-line bg-raised p-1.5">
        {MODES.map((m) => (
          <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-bold transition-colors motion-reduce:transition-none ${mode === m.id ? "bg-accent text-accent-ink" : "text-ink-soft hover:bg-hover"}`}>
            <m.Icon className="h-5 w-5" aria-hidden />{m.label}
          </button>
        ))}
      </div>
      {mode === "message" && <MessagePanel token={token} messages={messages} />}
      {mode === "leave" && <LeaveForm token={token} today={today} />}
      {mode === "swap" && <SwapForm token={token} today={today} mates={mates} />}
      {mode === "waste" && <WasteForm token={token} stock={stock} />}
      {mode !== "message" && <MyRequests token={token} requests={requests} />}
    </div>
  );
}

function useCreate(token: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  async function create(request: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true); setError(null); setSent(false);
    const r = await postJson<{ id: string }>("/api/team/request", { action: "create", token, request });
    setBusy(false);
    if (!r.ok) { setError(r.error); return false; }
    setSent(true);
    router.refresh();
    return true;
  }
  return { busy, error, sent, create };
}

function Feedback({ error, sent }: { error: string | null; sent: boolean }) {
  if (error) return <p role="alert" className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-sm font-bold text-danger">{error}</p>;
  if (sent) return <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok-bg px-3 py-2 text-sm font-bold text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden />وصل طلبك للإدارة، وترى قرارها هنا.</p>;
  return null;
}

function LeaveForm({ token, today }: { token: string; today: string }) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");
  const { busy, error, sent, create } = useCreate(token);
  const ready = Boolean(from && to && to >= from);
  return (
    <form className="space-y-3 rounded-2xl border border-line bg-raised p-4" onSubmit={async (e) => { e.preventDefault(); if (ready && await create({ kind: "LEAVE", fromDay: from, toDay: to, note })) setNote(""); }}>
      <h2 className="text-base font-bold">طلب إجازة</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className={lbl}>من<input type="date" dir="ltr" className={`${field} mt-1.5`} value={from} min={today} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></label>
        <label className={lbl}>إلى<input type="date" dir="ltr" className={`${field} mt-1.5`} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <label className={lbl}>السبب <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
      <Feedback error={error} sent={sent} />
      <ReadySubmit ready={ready} busy={busy} size="lg" className="w-full" missing="اختر يوم البداية والنهاية.">{busy ? "يُرسل…" : "أرسل الطلب"}</ReadySubmit>
    </form>
  );
}

function SwapForm({ token, today, mates }: { token: string; today: string; mates: readonly { id: string; name: string }[] }) {
  const [day, setDay] = useState(today);
  const [mate, setMate] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, sent, create } = useCreate(token);
  const ready = Boolean(day && mate);
  return (
    <form className="space-y-3 rounded-2xl border border-line bg-raised p-4" onSubmit={async (e) => { e.preventDefault(); if (ready && await create({ kind: "SWAP", fromDay: day, withEmployeeId: mate, note })) setNote(""); }}>
      <h2 className="text-base font-bold">تبديل مع زميل</h2>
      <p className="text-xs leading-relaxed text-ink-soft">يأخذ كلٌّ منكما دوام الآخر في هذا اليوم: إن كان يوم راحتك ويعمل فيه زميلك، تعمل أنت ويرتاح هو. اتفق معه أولاً، ثم تعتمده الإدارة.</p>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <label className={lbl}>اليوم<input type="date" dir="ltr" className={`${field} mt-1.5`} value={day} min={today} onChange={(e) => setDay(e.target.value)} /></label>
        <label className={lbl}>مع
          <select className={`${field} mt-1.5`} value={mate} onChange={(e) => setMate(e.target.value)}>
            <option value="">— اختر زميلك —</option>
            {mates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <label className={lbl}>ملاحظة <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="مثلاً: أعوّضه يوم الخميس" /></label>
      <Feedback error={error} sent={sent} />
      <ReadySubmit ready={ready} busy={busy} size="lg" className="w-full" missing="اختر اليوم والزميل.">{busy ? "يُرسل…" : "أرسل الطلب"}</ReadySubmit>
    </form>
  );
}

function WasteForm({ token, stock }: { token: string; stock: readonly StockOption[] }) {
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("SPILLED");
  const [note, setNote] = useState("");
  const { busy, error, sent, create } = useCreate(token);
  const product = stock.find((p) => p.id === productId);
  const ready = Boolean(product && /^\d+([.,٫]\d+)?$/.test(qty.trim()) && Number(qty.replace(/[,٫]/, ".")) > 0);
  if (stock.length === 0) return <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">لا أصناف في الجرد بعد.</p>;
  return (
    <form className="space-y-3 rounded-2xl border border-line bg-raised p-4" onSubmit={async (e) => {
      e.preventDefault();
      if (ready && product && await create({ kind: "WASTE", productId, quantity: qty.replace(/[,٫]/, "."), unit: product.unit, wasteReason: reason, note })) { setQty(""); setNote(""); }
    }}>
      <h2 className="text-base font-bold">تالف أو ضائع</h2>
      <label className={lbl}>الصنف
        <select className={`${field} mt-1.5`} value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">— اختر —</option>
          {stock.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className={lbl}>الكمية{product && <> ({product.unitLabel})</>}<input className={`${field} nums mt-1.5`} dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="1" /></label>
      <fieldset>
        <legend className={lbl}>ماذا حدث</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {REASONS.map(([id, l]) => (
            <button key={id} type="button" aria-pressed={reason === id} onClick={() => setReason(id)}
              className={`min-h-11 rounded-lg border px-3 text-xs font-bold ${reason === id ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-soft hover:bg-hover"}`}>{l}</button>
          ))}
        </div>
      </fieldset>
      <label className={lbl}>ملاحظة <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
      <Feedback error={error} sent={sent} />
      <ReadySubmit ready={ready} busy={busy} size="lg" className="w-full" missing={!product ? "اختر الصنف." : "اكتب الكمية رقماً."}>{busy ? "يُرسل…" : "أرسل"}</ReadySubmit>
    </form>
  );
}

const KIND_LABEL: Record<TeamRequestKind, string> = { BOARD_EDIT: "اقتراح تعديل", LEAVE: "إجازة", SWAP: "تبديل", WASTE: "تالف" };

function MyRequests({ token, requests }: { token: string; requests: MyRequestView[] }) {
  const router = useRouter();
  const shown = requests.filter((r) => r.status !== "WITHDRAWN");
  if (shown.length === 0) return null;
  return (
    <section aria-label="طلباتي">
      <h2 className="text-xs font-bold text-ink-soft">طلباتك</h2>
      <ul className="mt-2 space-y-2">
        {shown.map((r) => (
          <li key={r.id} className="rounded-xl border border-line bg-raised p-3.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{KIND_LABEL[r.kind]}</span>
              {r.status === "APPROVED" ? <span className="flex items-center gap-1 text-xs font-bold text-ok"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />اعتُمد</span>
                : r.status === "REJECTED" ? <span className="flex items-center gap-1 text-xs font-bold text-danger"><XCircle className="h-3.5 w-3.5" aria-hidden />لم يُعتمد</span>
                : <span className="flex items-center gap-1 text-xs text-muted"><Clock3 className="h-3.5 w-3.5" aria-hidden />ينتظر</span>}
            </div>
            <p className="mt-1 text-ink-soft">
              {r.kind === "LEAVE" && r.fromDay && <>{dayLabel(r.fromDay)}{r.toDay && r.toDay !== r.fromDay && <> إلى {dayLabel(r.toDay)}</>}</>}
              {r.kind === "SWAP" && r.fromDay && <>{dayLabel(r.fromDay)} مع {r.withEmployeeName ?? "زميل"}</>}
              {r.kind === "WASTE" && <>{r.productName} · <span className="nums">{r.quantity}</span></>}
              {r.kind === "BOARD_EDIT" && r.boardTitle}
            </p>
            {r.decisionNote && <p className="mt-1 text-xs text-ink-soft">رد الإدارة: {r.decisionNote}</p>}
            {r.status === "PENDING" && (
              <button type="button" className="mt-2 min-h-11 rounded-lg px-2 text-xs font-bold text-ink-soft hover:bg-hover sm:min-h-9"
                onClick={async () => { const x = await postJson("/api/team/request", { action: "withdraw", token, id: r.id }); if (x.ok) router.refresh(); }}>
                اسحب الطلب
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
