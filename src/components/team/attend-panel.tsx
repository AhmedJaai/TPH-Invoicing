"use client";

/**
 * الحضور في «TPH Team» — دوامُ اليوم والساعةُ الآن، وزرّا الحضور والانصراف، وما سجّله اليوم،
 * وتأخيرُه في فترة الخصم الجارية (أيّاماً ودقائق، بلا مال).
 *
 * يطلب الموقعَ ثمّ يرسل — وإن رُفض الموقعُ أو تأخّر يُرسل بلا موقع ويُقال له إنّ المدير سيراجعه،
 * فلا يقف الموظّفُ عند الباب.
 */
import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CheckCircle2, Coffee, LogIn, LogOut, MapPin, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { countNoun, DAY_AGO, MINUTE } from "@/lib/arabic";
import { clock12, nextKind, riyadhClock, trusted, VERDICT_LABEL } from "@/lib/payroll/attendance";
import type { CheckinVerdict } from "@/db/schema";

export interface RecentCheckin { id: string; kind: "IN" | "OUT"; at: string; day: string; verdict: CheckinVerdict }

export interface AttendPanelProps {
  token: string;
  recent: RecentCheckin[];
  /** يومُ الرياض اليوم. */
  today: string;
  /** «4:00 م – 12:00 ص» — `null` لم يُكتب دوامُه. */
  shiftRange: string | null;
  /** «HH:MM» بداية الدوام — لحساب «بقي على دوامك». */
  shiftStart: string | null;
  /** اليومُ يومُ راحته. */
  dayOff: boolean;
  /** «الجمعة والسبت». */
  daysOffLabel: string | null;
  /** تأخيرُه في فترة الخصم — `null`: لا يُحسب له (جزئيّ أو بلا دوام). */
  period: { from: string; lateDays: number; lateMinutes: number; earlyDays: number; earlyMinutes: number; absentDays: number } | null;
}

function position(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
  });
}

function everyFewSeconds(onChange: () => void): () => void {
  const t = window.setInterval(onChange, 5_000);
  return () => window.clearInterval(t);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });

export function AttendPanel({ token, recent: fromServer, today, shiftRange, shiftStart, dayOff, daysOffLabel, period }: AttendPanelProps) {
  const router = useRouter();
  /* ما سُجّل الآن يظهر فوراً، ثمّ يحلّ محلَّه ما يعيده الخادم بعد التحديث */
  const [optimistic, setOptimistic] = useState<RecentCheckin[]>([]);
  const [busy, setBusy] = useState<"IN" | "OUT" | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "warn" | "danger"; text: string } | null>(null);
  /* الساعةُ بالدقيقة — في الخادم لا ساعة، فلا تختلف الصفحتان عند التحميل */
  const minute = useSyncExternalStore(everyFewSeconds, currentMinute, () => null);
  const now = minute === null ? null : new Date(minute * 60_000);

  const recent = [
    ...optimistic.filter((o) => !fromServer.some((r) => r.kind === o.kind && Math.abs(Date.parse(r.at) - Date.parse(o.at)) < 5_000)),
    ...fromServer,
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const last = recent[0] ? { kind: recent[0].kind, at: new Date(recent[0].at) } : null;
  const suggested = nextKind(last, now ?? (last ? new Date(last.at) : new Date(0)));
  const todays = recent.filter((r) => r.day === today).reverse();
  const firstIn = todays.find((r) => r.kind === "IN");
  const lastOut = [...todays].reverse().find((r) => r.kind === "OUT");

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
    const clock = clock12(riyadhClock(new Date(d.at)));
    const ok = trusted(d.verdict);
    const what = kind === "IN" ? "حضورك" : "انصرافك";
    let text = d.duplicate ? `سُجّل ${what} قبل لحظات، لا حاجة للضغط مرة أخرى.` : `سُجّل ${what} الساعة ${clock}.`;
    if (!d.duplicate && kind === "IN" && d.lateMinutes > 0) text += ` تأخرت ${countNoun(d.lateMinutes, MINUTE)}.`;
    if (!d.duplicate && kind === "OUT" && d.earlyMinutes > 0) text += ` قبل نهاية الدوام بـ${countNoun(d.earlyMinutes, MINUTE)}.`;
    if (!ok) text += p ? " موقعك بعيد عن المقهى، فسيراجعه المدير." : " لم يُقرأ موقعك، فسيراجعه المدير. اسمح بالموقع في المرة القادمة.";
    setResult({ tone: ok ? "ok" : "warn", text });
    if (!d.duplicate) setOptimistic((xs) => [{ id: `local-${d.at}`, kind, at: d.at, day: today, verdict: d.verdict }, ...xs]);
    router.refresh();
  }

  /* «بقي على دوامك ٢٥ دقيقة» قبل البداية بساعتين، وما بعدها «بدأ دوامك» */
  let shiftNote: string | null = null;
  if (now && shiftStart && !dayOff && !firstIn) {
    const [h, m] = shiftStart.split(":").map(Number);
    const nowMin = Number(riyadhClock(now).slice(0, 2)) * 60 + Number(riyadhClock(now).slice(3, 5));
    const diff = h * 60 + m - nowMin;
    if (diff > 0 && diff <= 120) shiftNote = `يبدأ دوامك بعد ${countNoun(diff, MINUTE)}`;
    else if (diff <= 0 && diff > -240) shiftNote = "بدأ دوامك — سجّل حضورك";
  }

  const big = "flex min-h-24 w-full items-center justify-center gap-3 rounded-2xl text-lg font-bold shadow-raised transition active:scale-[0.98] disabled:opacity-60 motion-reduce:transition-none";
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-raised p-4 shadow-raised" aria-label="اليوم">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-bold">{now ? dateLabel(now.toISOString()) : " "}</p>
          <p className="nums text-2xl font-bold tabular-nums" aria-label="الساعة الآن">{now ? clock12(riyadhClock(now)) : " "}</p>
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
          {dayOff ? <><Coffee className="h-4 w-4 shrink-0 text-accent" aria-hidden />اليوم يوم راحتك</>
            : shiftRange ? <><CalendarCheck className="h-4 w-4 shrink-0 text-muted" aria-hidden />دوامك اليوم <span className="nums font-bold text-ink">{shiftRange}</span></>
            : <><CalendarCheck className="h-4 w-4 shrink-0 text-muted" aria-hidden />لم يحدّد المدير وقت دوامك بعد</>}
        </p>
        {shiftNote && <p className="mt-1 text-xs font-bold text-accent">{shiftNote}</p>}
        {(firstIn || lastOut) && (
          <p className="mt-2 text-xs text-ink-soft">
            {firstIn && <>حضرت <span className="nums font-bold">{clock12(riyadhClock(new Date(firstIn.at)))}</span></>}
            {firstIn && lastOut && " · "}
            {lastOut && <>انصرفت <span className="nums font-bold">{clock12(riyadhClock(new Date(lastOut.at)))}</span></>}
          </p>
        )}
        {daysOffLabel && !dayOff && <p className="mt-1 text-[11px] text-muted">راحتك {daysOffLabel}</p>}
      </section>

      <div className="space-y-3">
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
        <p role="status" className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-bold leading-relaxed ${
          result.tone === "ok" ? "border-ok/25 bg-ok-bg text-ok" : result.tone === "warn" ? "border-warn/25 bg-warn-bg text-warn" : "border-danger/25 bg-danger-bg text-danger"}`}>
          {result.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {result.text}
        </p>
      )}

      {period && (
        <section className="rounded-2xl border border-line bg-raised p-4" aria-label="هذه الفترة">
          <h2 className="text-xs font-bold text-ink-soft">منذ {dayLabel(period.from)}</h2>
          {period.lateDays + period.earlyDays + period.absentDays === 0 ? (
            <p className="mt-2 flex items-center gap-2 text-sm font-bold text-ok"><CheckCircle2 className="h-4 w-4" aria-hidden />لا تأخير ولا غياب. أحسنت.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {period.lateDays > 0 && <li>تأخرت في {countNoun(period.lateDays, DAY_AGO)}، مجموعها <span className="nums font-bold">{countNoun(period.lateMinutes, MINUTE)}</span></li>}
              {period.earlyDays > 0 && <li>انصرفت قبل الموعد في {countNoun(period.earlyDays, DAY_AGO)}، مجموعها <span className="nums font-bold">{countNoun(period.earlyMinutes, MINUTE)}</span></li>}
              {period.absentDays > 0 && <li>غبت {period.absentDays === 1 ? "يوماً واحداً" : countNoun(period.absentDays, DAY_AGO)}</li>}
            </ul>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-muted">يُحسب التأخير من أول حضور في اليوم. إن كان لك عذر فأخبر المدير أو أرسله من «رسالة للإدارة».</p>
        </section>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        يُقرأ موقع جوالك لحظة الضغط فقط، للتأكد أنك في المقهى. لا يُتتبَّع بعدها.
      </p>

      {recent.length > 0 && (
        <section>
          <h2 className="text-xs font-bold text-ink-soft">آخر تسجيلاتك</h2>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-raised">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0">{r.kind === "IN" ? "حضور" : "انصراف"} · <span className="text-muted">{dateLabel(r.at)}</span></span>
                <span className="flex shrink-0 items-center gap-2"><span className="nums font-bold">{clock12(riyadhClock(new Date(r.at)))}</span>
                  <span className={`text-[11px] ${trusted(r.verdict) ? "text-ok" : "text-warn"}`}>{VERDICT_LABEL[r.verdict]}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
