"use client";

/**
 * «الجرد» في TPH Team — جردُ السبت يُدخله الموظّفُ المأذونُ له بدل ملفّ إكسل.
 *
 * يقف عند الرفّ بجواله: خانةٌ لكلّ صنف بوحدةٍ يختارها (كجم أو جرام)، وبحثٌ بالاسم، و«احفظ» تحفظ
 * ما تغيّر وحده. **والعدُّ أعمى**: لا متوقَّعَ ولا فرق. وما كُتب ولم يُحفظ يبقى في الجوال إن أُغلقت
 * الصفحة (راحةٌ لا حقيقة: الحقيقةُ ما حُفظ في الخادم).
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, CheckCircle2, ClipboardList, Lock, Search } from "lucide-react";
import { postJson } from "@/lib/http-client";
import type { TeamCountView } from "@/services/team-count.service";

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const weekText = (w: { start: string; end: string }) => `من ${dayLabel(w.start)} إلى ${dayLabel(w.end)}`;

export function CountPanel({ token, view }: { token: string; view: TeamCountView }) {
  if (view.state === "closed") {
    return (
      <Notice icon={CalendarClock} title={`الجرد يوم ${dayLabel(view.nextSaturday)}`}>
        يُفتح جرد الأسبوع هنا يوم السبت بعد التقفيلة، ويبقى مفتوحاً حتى نهاية الأحد.
        {view.lastCounted !== null && <span className="mt-1 block">جرد الأسبوع الماضي: سُجّل فيه {view.lastCounted} صنفاً.</span>}
      </Notice>
    );
  }
  if (view.state === "locked") {
    return <Notice icon={Lock} title="أُقفل جرد هذا الأسبوع">أقفلته الإدارة بعد مراجعته، فلا يُعدَّل من هنا. إن وجدت خطأ فأرسل رسالة من «طلباتي».</Notice>;
  }
  if (view.state === "not-started") return <StartCount token={token} week={view.week} />;
  return <CountSheet key={view.countId} token={token} countId={view.countId} week={view.week} lines={view.lines} />;
}

function Notice({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-raised p-5 text-center">
      <Icon className="mx-auto h-8 w-8 text-accent" aria-hidden />
      <h2 className="mt-3 text-base font-bold">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{children}</p>
    </section>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-sm font-bold text-danger">{error}</p> : null;
}

function StartCount({ token, week }: { token: string; week: { start: string; end: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    if (busy) return;
    setBusy(true); setError(null);
    const r = await postJson("/api/team/count", { action: "start", token });
    if (!r.ok) { setBusy(false); setError(r.error); return; }
    router.refresh();
  }
  return (
    <section className="space-y-4 rounded-2xl border border-accent-line bg-raised p-5 text-center">
      <ClipboardList className="mx-auto h-8 w-8 text-accent" aria-hidden />
      <div>
        <h2 className="text-base font-bold">جرد السبت</h2>
        <p className="mt-1 text-sm text-ink-soft">أسبوع {weekText(week)}</p>
      </div>
      <button type="button" onClick={() => void start()} disabled={busy} aria-busy={busy}
        className="min-h-12 w-full rounded-xl bg-accent px-4 text-base font-bold text-accent-ink disabled:opacity-60">
        {busy ? "يُجهَّز الجرد…" : "ابدأ الجرد"}
      </button>
      <ErrorLine error={error} />
    </section>
  );
}

type Line = Extract<TeamCountView, { state: "open" }>["lines"][number];
interface Draft { quantity: string; unit: string }

const noSubscribe = () => () => {};
const draftKey = (countId: string) => `tph-team.count.${countId}`;
function readDrafts(countId: string): string {
  try { return window.localStorage.getItem(draftKey(countId)) ?? "{}"; } catch { return "{}"; }
}
function parseDrafts(raw: string | null): Record<string, Draft> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    const out: Record<string, Draft> = {};
    if (!v || typeof v !== "object") return out;
    for (const [id, d] of Object.entries(v)) {
      if (d && typeof d === "object" && "quantity" in d && "unit" in d && typeof d.quantity === "string" && typeof d.unit === "string") out[id] = { quantity: d.quantity, unit: d.unit };
    }
    return out;
  } catch { return {}; }
}

function CountSheet({ token, countId, week, lines }: { token: string; countId: string; week: { start: string; end: string }; lines: Line[] }) {
  const router = useRouter();
  /* المسوّدةُ من الجوال بعد التركيب — في الخادم لا تخزين */
  const stored = useSyncExternalStore(noSubscribe, () => readDrafts(countId), () => null);
  const [edits, setEdits] = useState<Record<string, Draft> | null>(null);
  const drafts = useMemo(() => edits ?? parseDrafts(stored), [edits, stored]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const dirty = Object.keys(drafts).filter((id) => lines.some((l) => l.productId === id));
  const counted = lines.filter((l) => l.counted !== null).length;

  useEffect(() => {
    if (edits === null) return;
    try { window.localStorage.setItem(draftKey(countId), JSON.stringify(edits)); } catch { /* تبقى في الصفحة */ }
  }, [edits, countId]);
  useEffect(() => {
    if (dirty.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.length]);

  function edit(line: Line, patch: Partial<Draft>) {
    setSaved(null);
    const cur = drafts[line.productId] ?? { quantity: "", unit: line.baseUnit };
    setEdits({ ...drafts, [line.productId]: { ...cur, ...patch } });
  }

  async function save() {
    if (busy || dirty.length === 0) return;
    setBusy(true); setError(null); setSaved(null);
    const entries = dirty.map((productId) => ({ productId, quantity: drafts[productId].quantity.trim(), unit: drafts[productId].unit }));
    const r = await postJson<{ message?: string }>("/api/team/count", { action: "save", token, countId, entries });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setEdits({});
    setSaved(r.data.message ?? "حُفظ");
    router.refresh();
  }

  const q = query.trim();
  const shown = q ? lines.filter((l) => l.name.includes(q) || l.name.toLowerCase().includes(q.toLowerCase())) : lines;
  const groups = [...new Set(shown.map((l) => l.categoryLabel))];

  if (lines.length === 0) {
    return <Notice icon={ClipboardList} title="لا أصناف في هذا الجرد بعد">لم تُحدَّد الأصناف التي تُعدّ. أرسل للإدارة لتختارها من صفحة الجرد.</Notice>;
  }

  return (
    <div className="space-y-4 pb-20">
      <section className="rounded-2xl border border-line bg-raised p-4">
        <h2 className="text-base font-bold">جرد السبت</h2>
        <p className="mt-0.5 text-xs text-ink-soft">أسبوع {weekText(week)}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={lines.length} aria-valuenow={counted} aria-label="ما عُدّ">
          <div className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${Math.round((counted / lines.length) * 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs font-bold text-ink-soft">عُدّ {counted} من {lines.length} صنفاً</p>
      </section>

      <label className="relative block">
        <span className="sr-only">ابحث عن صنف</span>
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث عن صنف"
          className="min-h-12 w-full rounded-xl border border-line-input bg-surface ps-9 pe-3 text-base focus:border-accent focus:outline-none" />
      </label>

      {groups.map((g) => (
        <section key={g} aria-label={g}>
          <h3 className="mb-2 text-xs font-bold text-muted">{g}</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised">
            {shown.filter((l) => l.categoryLabel === g).map((l) => {
              const d = drafts[l.productId];
              return (
                <li key={l.productId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1 basis-32">
                    <p className="text-sm font-bold">{l.name}</p>
                    <p className="text-[11px] text-muted">
                      {d ? <span className="font-bold text-warn">لم يُحفظ بعد</span>
                        : l.counted !== null ? <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 className="h-3 w-3" aria-hidden />سُجّل {l.counted}</span>
                          : "لم يُعَدّ"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input inputMode="decimal" dir="ltr" value={d?.quantity ?? ""} onChange={(e) => edit(l, { quantity: e.target.value })}
                      aria-label={`كمية ${l.name}`} placeholder={l.counted === null ? "الكمية" : "تعديل"}
                      className="min-h-11 w-24 rounded-lg border border-line-input bg-surface px-2 text-center text-base focus:border-accent focus:outline-none" />
                    {l.units.length > 1 ? (
                      <select value={d?.unit ?? l.baseUnit} onChange={(e) => edit(l, { unit: e.target.value })} aria-label={`وحدة ${l.name}`}
                        className="min-h-11 rounded-lg border border-line-input bg-surface px-1.5 text-sm">
                        {l.units.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                      </select>
                    ) : <span className="min-w-10 text-center text-xs text-muted">{l.units[0]?.label}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted">لا صنف بهذا الاسم.</p>}

      <div className="fixed inset-x-0 bottom-(--team-nav) z-30 mx-auto max-w-lg space-y-2 px-4 pb-2">
        <ErrorLine error={error} />
        {saved && <p role="status" className="flex items-center gap-2 rounded-lg border border-ok/25 bg-ok-bg px-3 py-2 text-sm font-bold text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden />{saved}</p>}
        {dirty.length > 0 && (
          <button type="button" onClick={() => void save()} disabled={busy} aria-busy={busy}
            className="min-h-12 w-full rounded-xl bg-accent px-4 text-base font-bold text-accent-ink shadow-lifted disabled:opacity-60">
            {busy ? "يُحفظ…" : `احفظ (${dirty.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
