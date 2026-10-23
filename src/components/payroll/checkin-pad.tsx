"use client";

/**
 * زرّا الحضور والانصراف على جوال الموظّف. يطلب الموقعَ ثمّ يرسل — وإن رُفض الموقعُ أو تأخّر
 * يُرسل بلا موقع ويُقال له إنّ المدير سيراجعه، فلا يقف الموظّفُ عند الباب.
 */
import { useState } from "react";
import { CheckCircle2, LogIn, LogOut, MapPin, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/icons";
import { postJson } from "@/lib/http-client";
import { riyadhClock, VERDICT_LABEL } from "@/lib/payroll/attendance";
import type { CheckinVerdict } from "@/db/schema";

interface Recent { id: string; kind: "IN" | "OUT"; at: string; verdict: CheckinVerdict }

function position(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
  });
}

export function CheckinPad({ token, name, shiftStart, recent: initial, suggested: initialSuggested }: { token: string; name: string; shiftStart: string | null; recent: Recent[]; suggested: "IN" | "OUT" }) {
  const [recent, setRecent] = useState(initial);
  const [suggested, setSuggested] = useState(initialSuggested);
  const [busy, setBusy] = useState<"IN" | "OUT" | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);

  async function record(kind: "IN" | "OUT") {
    if (busy) return;
    setBusy(kind);
    setResult(null);
    const p = await position();
    const r = await postJson<{ verdict: CheckinVerdict; at: string; lateMinutes: number; earlyMinutes: number; duplicate: boolean }>("/api/attend", {
      token, kind,
      ...(p ? { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } : {}),
    });
    setBusy(null);
    if (!r.ok) { setResult({ tone: "danger", text: r.error }); return; }
    const d = r.data;
    const clock = riyadhClock(new Date(d.at));
    const trusted = d.verdict === "IN_PLACE" || d.verdict === "ON_NETWORK";
    const what = kind === "IN" ? "حضورك" : "انصرافك";
    let text = d.duplicate ? `سُجّل ${what} قبل لحظات، لا حاجة للضغط مرة أخرى.` : `سُجّل ${what} الساعة ${clock}.`;
    if (!d.duplicate && kind === "IN" && d.lateMinutes > 0) text += ` تأخرت ${d.lateMinutes} دقيقة.`;
    if (!d.duplicate && kind === "OUT" && d.earlyMinutes > 0) text += ` قبل نهاية الدوام بـ${d.earlyMinutes} دقيقة.`;
    if (!trusted) text += p ? " موقعك بعيد عن المقهى، فسيراجعه المدير." : " لم يُقرأ موقعك، فسيراجعه المدير. اسمح بالموقع في المرة القادمة.";
    setResult({ tone: trusted ? "ok" : "warn", text });
    if (!d.duplicate) setRecent((xs) => [{ id: d.at, kind, at: d.at, verdict: d.verdict }, ...xs].slice(0, 6));
    setSuggested(kind === "IN" ? "OUT" : "IN");
  }

  const big = "flex min-h-24 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold shadow-raised transition active:scale-[0.98] disabled:opacity-60";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-surface px-5 pb-10 pt-8">
      <div className="flex items-center gap-3">
        <BrandMark className="h-9 w-auto text-accent" />
        <div>
          <p className="text-xs text-muted">ذا بوبليك هاوس</p>
          <h1 className="text-lg font-bold">أهلاً {name}</h1>
        </div>
      </div>
      {shiftStart && <p className="mt-4 text-sm text-ink-soft">دوامك يبدأ <span className="nums font-bold" dir="ltr">{shiftStart}</span></p>}

      <div className="mt-6 space-y-3">
        <button type="button" onClick={() => void record("IN")} disabled={busy !== null} aria-busy={busy === "IN"}
          className={`${big} ${suggested === "IN" ? "bg-accent text-accent-ink" : "border border-line bg-raised text-ink"}`}>
          <LogIn className="h-6 w-6" aria-hidden />{busy === "IN" ? "يُسجَّل…" : "سجّل حضوري"}
        </button>
        <button type="button" onClick={() => void record("OUT")} disabled={busy !== null} aria-busy={busy === "OUT"}
          className={`${big} ${suggested === "OUT" ? "bg-accent text-accent-ink" : "border border-line bg-raised text-ink"}`}>
          <LogOut className="h-6 w-6" aria-hidden />{busy === "OUT" ? "يُسجَّل…" : "سجّل انصرافي"}
        </button>
      </div>

      {result && (
        <p role="status" className={`mt-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-bold leading-relaxed ${
          result.tone === "ok" ? "border-ok/25 bg-ok-bg text-ok" : result.tone === "warn" ? "border-warn/25 bg-warn-bg text-warn" : "border-danger/25 bg-danger-bg text-danger"}`}>
          {result.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {result.text}
        </p>
      )}

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        يُقرأ موقع جوالك لحظة الضغط فقط، للتأكد أنك في المقهى. لا يُتتبَّع بعدها.
      </p>

      {recent.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-bold text-ink-soft">آخر تسجيلاتك</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-raised">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>{r.kind === "IN" ? "حضور" : "انصراف"} · <span className="text-muted">{new Date(r.at).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" })}</span></span>
                <span className="flex items-center gap-2"><span className="nums font-bold" dir="ltr">{riyadhClock(new Date(r.at))}</span>
                  <span className={`text-[11px] ${r.verdict === "IN_PLACE" || r.verdict === "ON_NETWORK" ? "text-ok" : "text-warn"}`}>{VERDICT_LABEL[r.verdict]}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
