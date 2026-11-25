"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen, LoaderCircle } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatMonth } from "@/lib/riyadh-time";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import type { MonthInCorrection } from "@/services/month-correction.service";

const signed = (minor: number) => `${minor > 0 ? "+" : minor < 0 ? "−" : ""}${formatRiyalsDisplay(Math.abs(minor))}`;

/**
 * التصحيحُ في أشهرٍ مقفلة بخطوتين لا بستّ: تُفتح الأشهرُ معاً بسببٍ واحد، ويُرى كم تغيّر ربحُ
 * كلٍّ منها عمّا خُتم وهو يُصحَّح، ثمّ تُقفل معاً — شهراً بعد شهر من باب الإقفال نفسه، فإن
 * منع مانعٌ شهراً وقف عنده وقيل سببُه، وما قبله أُقفل.
 */
export function MonthCorrection({ open, closed, canReopen }: {
  open: MonthInCorrection[];
  /** الأشهرُ المقفلة الآن — مرشّحاتُ الفتح. */
  closed: string[];
  canReopen: boolean;
}) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(months: string[], action: "reopen" | "close", note: string) {
    for (const m of [...months].sort()) {
      setBusy(`${action === "reopen" ? "يفتح" : "يُقفل"} ${formatMonth(m)}…`);
      const r = await postJson<{ message?: string }>("/api/month-close", { month: m, action, note });
      if (!r.ok) {
        setBusy(null);
        toast({ tone: "danger", title: `توقّف عند ${formatMonth(m)}`, body: r.error });
        router.refresh();
        return false;
      }
    }
    setBusy(null);
    router.refresh();
    return true;
  }

  async function reopen() {
    if (picked.size === 0 || reason.trim().length < 3) return;
    if (await run([...picked], "reopen", reason.trim())) {
      toast({ tone: "warn", title: `فُتح ${picked.size === 1 ? "شهر" : `${picked.size} أشهر`} للتصحيح`, body: "صحّح ما تريد، وتراه هنا بفرقه عمّا خُتم، ثم أقفلها معاً." });
      setPicked(new Set()); setReason(""); setPicking(false);
    }
  }

  async function closeAll() {
    const note = `إعادة إقفال بعد التصحيح${open[0]?.reason ? `: ${open[0].reason}` : ""}`;
    if (await run(open.map((o) => o.month), "close", note)) {
      toast({ tone: "ok", title: "أُقفلت كلها وخُتمت أرقامها من جديد" });
    }
  }

  if (open.length === 0 && (!canReopen || closed.length === 0)) return null;

  return (
    <section aria-labelledby="correction" className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="correction" className="flex items-center gap-2 text-sm font-bold">
            <LockOpen className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden /> تصحيح أشهر مقفلة
          </h2>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">
            افتح الأشهر التي تريد تصحيحها معاً بسبب واحد، وترى هنا كم تغيّر ربح كل شهر عمّا خُتم، ثم أقفلها معاً.
          </p>
        </div>
        {canReopen && !picking && closed.length > 0 && (
          <button type="button" onClick={() => setPicking(true)} disabled={busy !== null} className={buttonClass("secondary", "sm")}>افتح للتصحيح</button>
        )}
      </div>

      {picking && (
        <div className="mt-4 space-y-3 rounded-xl bg-sunken/60 p-3">
          <fieldset>
            <legend className="text-xs font-bold">أي الأشهر؟</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...closed].sort().map((m) => (
                <label key={m} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-bold ${picked.has(m) ? "border-accent-line bg-accent-soft/60" : "border-line bg-raised"}`}>
                  <input type="checkbox" checked={picked.has(m)} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n; })} />
                  {formatMonth(m)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs font-bold">
            لماذا؟ يُحفظ في سجل التدقيق لكل شهر
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="مثلاً: فاتورة متأخرة، أو تصحيح توزيع الإيجار" className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm font-normal" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void reopen()} disabled={busy !== null || picked.size === 0 || reason.trim().length < 3} className={buttonClass("primary", "sm")}>
              {picked.size > 1 ? `افتح ${picked.size} أشهر` : "افتح"}
            </button>
            <button type="button" onClick={() => { setPicking(false); setPicked(new Set()); }} disabled={busy !== null} className={buttonClass("quiet", "sm")}>إلغاء</button>
          </div>
        </div>
      )}

      {open.length > 0 && (
        <>
          <ul className="mt-4 divide-y divide-line-soft overflow-hidden rounded-xl border border-line">
            {open.map((o) => (
              <li key={o.month} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="font-bold">{formatMonth(o.month)} <span className="text-[11px] font-normal text-muted">مفتوح للتصحيح{o.reason ? ` · ${o.reason}` : ""}</span></span>
                <span className="text-xs text-ink-soft">
                  {o.deltaMinor === null ? "الفرق غير معروف" : o.deltaMinor === 0
                    ? "الربح كما خُتم"
                    : <>الربح <bdi className="nums font-bold">{signed(o.deltaMinor)}</bdi> عمّا خُتم ({formatRiyalsDisplay(o.frozenProfitMinor ?? 0)} ← {formatRiyalsDisplay(o.liveProfitMinor ?? 0)})</>}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void closeAll()} disabled={busy !== null} aria-busy={busy !== null} className={buttonClass("primary")}>
              <Lock className="h-4 w-4" strokeWidth={2} aria-hidden />
              {open.length > 1 ? `أعد إقفالها كلها (${open.length})` : `أعد إقفال ${formatMonth(open[0].month)}`}
            </button>
            <span className="text-[11px] text-muted">يُفحص كل شهر قبل إقفاله، ويُجمَّد ربحه ويُختم من جديد.</span>
          </div>
        </>
      )}
      {busy && (
        <p role="status" className="mt-3 flex items-center gap-2 text-xs font-bold text-ink-soft">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> {busy}
        </p>
      )}
    </section>
  );
}
