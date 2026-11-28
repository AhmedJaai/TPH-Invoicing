"use client";

/**
 * الحضور في «TPH Team» — يُفتح عند الباب على عجل، فالصفحةُ جوابٌ وزرّ:
 *
 *   ١. أين أنت الآن؟ «لم تسجّل حضورك بعد · بدأ دوامك قبل ٧ دقائق» أو «في الدوام منذ ٤:٥٨ م».
 *   ٢. زرٌّ واحدٌ كبير بما يلزمك الآن (حضور أو انصراف)، والآخرُ رابطٌ صغير تحته.
 *   ٣. النتيجةُ بسببها: سُجّل، أو سُجّل ويراجعه المدير (رفضتَ الموقع · بعيدٌ بكذا متراً · لم يُقرأ)،
 *      أو «حضورك مسجّل من قبل»، أو لم يصل (الشبكة) وبجانبه «أعد المحاولة».
 *   ٤. ما سُجّل له هذا الأسبوع يوماً بيوم — أوقاتٌ بلا حكمٍ ولا خصم.
 *
 * التكرارُ لا يُكتب مرّتين في الخادم (`repeatOf`): ضغطتان، أو إعادةُ طلبٍ ضاع ردُّه، أو حضورٌ ثانٍ
 * في يومه — فإعادةُ المحاولة آمنة، ويُعاد الطلبُ مرّةً وحده إن لم يصل.
 *
 * الموقعُ يُطلب لحظةَ الضغط، وإن رُفض أو تأخّر يُرسل بلاه — لا يقف الموظّفُ عند الباب.
 * وتأخيرُ الفترة والقسيمةُ خلف «ملخّص الشهر» (أحمد: عرضُهما كلّما فتح التطبيق «شعور غير جميل»).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck, CheckCircle2, ChevronUp, Coffee, Info, Loader2, LogIn, LogOut, MapPin, MapPinOff, RotateCw, TriangleAlert, WifiOff, type LucideIcon,
} from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, countNounGen, DAY_AGO, HOUR, MINUTE } from "@/lib/arabic";
import { clock12, isWorkday, lateMinutesAt, nextKind, riyadhClock, trusted } from "@/lib/payroll/attendance";
import { addDays } from "@/lib/riyadh-time";
import type { CheckinVerdict } from "@/db/schema";

export interface RecentCheckin { id: string; kind: "IN" | "OUT"; at: string; day: string; verdict: CheckinVerdict }

export interface AttendPanelProps {
  token: string;
  /** تسجيلاتُه الأخيرة، الأحدثُ أوّلاً — تكفي أسبوعاً. */
  recent: RecentCheckin[];
  /** يومُ الرياض اليوم. */
  today: string;
  /** «4:00 م – 12:00 ص» — `null` لم يُكتب دوامُه. */
  shiftRange: string | null;
  /** «HH:MM» بداية الدوام — لحساب «بقي على دوامك». */
  shiftStart: string | null;
  /** دقائقُ السماح: تأخيرٌ في حدودها لا يُحسب. */
  graceMinutes: number;
  /** اليومُ يومُ راحته. */
  dayOff: boolean;
  /** أيّامُ راحته أرقاماً («56») — لأيّام الأسبوع الماضية. */
  daysOff: string;
  /** «الجمعة والسبت». */
  daysOffLabel: string | null;
  /** تأخيرُه في فترة الخصم — `null`: لا يُحسب له (جزئيّ أو بلا دوام). */
  period: { from: string; lateDays: number; lateMinutes: number; earlyDays: number; earlyMinutes: number; absentDays: number } | null;
  /** دوامُ الأيّام السبعة القادمة بيومها. */
  week: { day: string; range: string | null; off: boolean }[];
  /** قسيمةُ آخر شهرٍ نشرته الإدارة — `null` لا منشور. */
  slip: { month: string; baseMinor: number | null; additionsMinor: number; deductionsMinor: number | null; advancesMinor: number; dueMinor: number | null; paidMinor: number; remainingMinor: number | null } | null;
}

type Kind = "IN" | "OUT";
type Located = { pos: GeolocationPosition; why: null } | { pos: null; why: "denied" | "weak" | "unsupported" };
type Phase = "locating" | "sending" | "slow" | "retrying";
type Outcome = { tone: "ok" | "warn" | "danger" | "info"; icon: LucideIcon; title: string; body?: string; retry?: Kind };
interface AttendResponse { verdict: CheckinVerdict; at: string; distanceM: number | null; lateMinutes: number; earlyMinutes: number; duplicate: boolean; repeat: "DOUBLE_TAP" | "ALREADY_IN" | null }

const PHASE_LABEL: Record<Phase, string> = {
  locating: "يقرأ موقعك…",
  sending: "يُسجَّل…",
  slow: "الشبكة بطيئة، لا تغلق الصفحة…",
  retrying: "لم يصل، يُعاد الإرسال…",
};

function locate(): Promise<Located> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { resolve({ pos: null, why: "unsupported" }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ pos, why: null }),
      (e) => resolve({ pos: null, why: e.code === e.PERMISSION_DENIED ? "denied" : "weak" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

function everyFewSeconds(onChange: () => void): () => void {
  const t = window.setInterval(onChange, 5_000);
  return () => window.clearInterval(t);
}
const currentMinute = () => Math.floor(Date.now() / 60_000);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/* «٢:٥٥ م» لا تنكسر عند آخر السطر فتبقى «م» وحدها */
const at12 = (iso: string) => clock12(riyadhClock(new Date(iso))).replace(" ", "\u00a0");

const dateLabel = (d: Date) => d.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" });
const weekdayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", timeZone: "UTC" });
const monthLabel = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" });
/** «نحو ٣٥٠ متراً» — بالعشرات، فدقّةُ الجوّال لا تسمح بأكثر. */
const meters = (m: number) => m >= 1_000 ? `نحو ${Math.round(m / 100) / 10} كم` : `نحو ${Math.max(10, Math.round(m / 10) * 10)} متر`;

/** «بساعتين و٥ دقائق» — المدّةُ بعد حرف جرّ؛ الساعاتُ فوق الستين دقيقة. */
function span(minutes: number): string {
  if (minutes < 60) return countNounGen(minutes, MINUTE);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m === 0 ? countNounGen(h, HOUR) : `${countNounGen(h, HOUR)} و${countNounGen(m, MINUTE)}`;
}

/** نصُّ النتيجة — من ردّ الخادم وحده، وسببُ الموقع من المتصفّح. */
function outcomeOf(kind: Kind, d: AttendResponse, loc: Located, shiftStart: string | null, graceMinutes: number): Outcome {
  const clock = at12(d.at);
  const what = kind === "IN" ? "حضورك" : "انصرافك";
  if (d.repeat === "ALREADY_IN") {
    return { tone: "info", icon: Info, title: `حضورك مسجّل من الساعة ${clock}`, body: "لا حاجة لتسجيله مرة أخرى. حين تنتهي سجّل انصرافك." };
  }
  if (d.repeat === "DOUBLE_TAP") {
    return { tone: trusted(d.verdict) ? "ok" : "warn", icon: CheckCircle2, title: `سُجّل ${what} الساعة ${clock}`, body: "وصلت ضغطتك الأولى، فلم يُسجَّل مرتين." };
  }
  const notes: string[] = [];
  if (kind === "IN" && shiftStart) notes.push(d.lateMinutes > graceMinutes ? `بعد بداية دوامك بـ${span(d.lateMinutes)}.` : "في الوقت.");
  if (kind === "OUT" && d.earlyMinutes > 0) notes.push(`قبل نهاية دوامك بـ${span(d.earlyMinutes)}.`);
  if (trusted(d.verdict)) return { tone: "ok", icon: CheckCircle2, title: `سُجّل ${what} الساعة ${clock}`, body: notes.join(" ") || undefined };
  /* سُجّل ولكن بلا شاهد — يُقال السببُ وما يفعله في المرّة القادمة */
  const why = loc.why === "denied" ? "لم تسمح بقراءة موقعك، فسيراجع المدير تسجيلك. للسماح في المرة القادمة: من إعدادات المتصفح اسمح بالموقع لهذه الصفحة."
    : loc.why === "unsupported" ? "جوالك لا يتيح قراءة الموقع من المتصفح، فسيراجع المدير تسجيلك."
    : loc.why === "weak" ? "لم يُقرأ موقعك هذه المرة (الإشارة ضعيفة)، فسيراجع المدير تسجيلك. شغّل الموقع واتصل بشبكة المقهى."
    : d.distanceM !== null ? `قُرئ موقعك على بعد ${meters(d.distanceM)} من المقهى، فسيراجع المدير تسجيلك. إن كنت في المقهى فاتصل بشبكته.`
    : "موقعك خارج المقهى، فسيراجع المدير تسجيلك.";
  return { tone: "warn", icon: loc.why ? MapPinOff : MapPin, title: `سُجّل ${what} الساعة ${clock}`, body: [...notes, why].join(" ") };
}

export function AttendPanel({ token, recent: fromServer, today, shiftRange, shiftStart, graceMinutes, dayOff, daysOff, daysOffLabel, period, week, slip }: AttendPanelProps) {
  const router = useRouter();
  /* ما سُجّل الآن يظهر فوراً، ثمّ يحلّ محلَّه ما يعيده الخادم بعد التحديث */
  const [optimistic, setOptimistic] = useState<RecentCheckin[]>([]);
  const [busy, setBusy] = useState<{ kind: Kind; phase: Phase } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [details, setDetails] = useState(false);
  const [showWeek, setShowWeek] = useState(false);
  /* بعد التسجيل يهدأ الزرّان لحظة: الزرُّ الكبير يتبدّل (حضور ← انصراف)، فالضغطةُ الثانية من نقرةٍ
     مزدوجة كانت تسجّل انصرافاً بعد الحضور مباشرة — جُرّب فوقع */
  const [settled, setSettled] = useState(false);
  /* قفلٌ متزامن: ضغطتان قبل أن يُعاد رسمُ الزرّ لا تُرسلان طلبين */
  const inFlight = useRef(false);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const minute = useSyncExternalStore(everyFewSeconds, currentMinute, () => null);
  const now = minute === null ? null : new Date(minute * 60_000);

  useEffect(() => { if (outcome) outcomeRef.current?.focus(); }, [outcome]);

  const recent = [
    ...optimistic.filter((o) => !fromServer.some((r) => r.kind === o.kind && Math.abs(Date.parse(r.at) - Date.parse(o.at)) < 5_000)),
    ...fromServer,
  ].sort((a, b) => b.at.localeCompare(a.at));
  const last = recent[0] ?? null;
  const suggested = nextKind(last ? { kind: last.kind, at: new Date(last.at) } : null, now ?? (last ? new Date(last.at) : new Date(0)));
  const other: Kind = suggested === "IN" ? "OUT" : "IN";
  const todays = recent.filter((r) => r.day === today);
  const firstInToday = todays.filter((r) => r.kind === "IN").at(-1) ?? null;

  async function record(kind: Kind) {
    if (inFlight.current) return;
    inFlight.current = true;
    setOutcome(null);
    setBusy({ kind, phase: "locating" });
    const loc = await locate();
    setBusy({ kind, phase: "sending" });
    const slow = window.setTimeout(() => setBusy((b) => (b ? { ...b, phase: "slow" } : b)), 6_000);
    const body = { token, kind, ...(loc.pos ? { lat: loc.pos.coords.latitude, lng: loc.pos.coords.longitude, accuracy: loc.pos.coords.accuracy } : {}) };
    let r = await postJson<AttendResponse>("/api/attend", body);
    /* لم يصل — يُعاد مرّةً وحده؛ والخادمُ لا يكتب التكرار إن كان الأوّلُ قد وصل */
    if (!r.ok && r.status === 0) {
      setBusy({ kind, phase: "retrying" });
      await wait(1_500);
      r = await postJson<AttendResponse>("/api/attend", body);
    }
    window.clearTimeout(slow);
    setBusy(null);
    inFlight.current = false;
    if (!r.ok) {
      const offline = r.status === 0;
      setOutcome({
        tone: "danger", icon: offline ? WifiOff : TriangleAlert,
        title: offline ? `لم يُسجَّل ${kind === "IN" ? "حضورك" : "انصرافك"}: لا اتصال` : `لم يُسجَّل ${kind === "IN" ? "حضورك" : "انصرافك"}`,
        body: offline ? "تأكد من الإنترنت أو اتصل بشبكة المقهى، ثم أعد المحاولة. لن يُسجَّل مرتين." : r.error,
        retry: offline || r.status >= 500 || r.status === 429 ? kind : undefined,
      });
      return;
    }
    const d = r.data;
    setOutcome(outcomeOf(kind, d, loc, shiftStart, graceMinutes));
    if (!d.duplicate) {
      if ("vibrate" in navigator) navigator.vibrate?.(40);
      setSettled(true);
      window.setTimeout(() => setSettled(false), 2_500);
      setOptimistic((xs) => [{ id: `local-${d.at}`, kind, at: d.at, day: today, verdict: d.verdict }, ...xs]);
    }
    router.refresh();
  }

  /* الجوابُ في رأس الصفحة: أين أنت من دوامك الآن؟ */
  let state: { title: string; note: string | null; tone: "ok" | "warn" | "muted" } = { title: "", note: null, tone: "muted" };
  if (last && suggested === "OUT") {
    const late = shiftStart && firstInToday && last.id === firstInToday.id ? lateMinutesAt(new Date(firstInToday.at), today, shiftStart) : 0;
    state = {
      title: `في الدوام منذ ${at12(last.at)}`,
      note: shiftStart && firstInToday && last.id === firstInToday.id ? (late > graceMinutes ? `حضرت بعد بداية دوامك بـ${span(late)}` : "حضرت في الوقت") : null,
      tone: "ok",
    };
  } else if (last && last.kind === "OUT" && last.day === today) {
    state = { title: `انصرفت الساعة ${at12(last.at)}`, note: firstInToday ? `حضرت ${at12(firstInToday.at)}` : null, tone: "muted" };
  } else if (dayOff) {
    state = { title: "اليوم يوم راحتك", note: "إن جئت للعمل فسجّل حضورك كالمعتاد.", tone: "muted" };
  } else {
    let note: string | null = null, tone: "warn" | "muted" = "muted";
    if (now && shiftStart) {
      const late = lateMinutesAt(now, today, shiftStart);
      const [h, m] = shiftStart.split(":").map(Number);
      const nowMin = Number(riyadhClock(now).slice(0, 2)) * 60 + Number(riyadhClock(now).slice(3, 5));
      const ahead = h * 60 + m - nowMin;
      if (ahead > 0 && ahead <= 120) note = `يبدأ دوامك بعد ${span(ahead)}`;
      else if (late > 0 && late <= 240) { note = `بدأ دوامك قبل ${span(late)}`; tone = late > graceMinutes ? "warn" : "muted"; }
    }
    state = { title: "لم تسجّل حضورك بعد", note, tone };
  }

  /* هذا الأسبوع: سبعةُ أيّامٍ تنتهي اليوم، بأوّل حضورٍ وآخر انصرافٍ في كلٍّ */
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).reverse();
  const byDay = days.map((day) => {
    const rows = recent.filter((r) => r.day === day);
    const ins = rows.filter((r) => r.kind === "IN"), outs = rows.filter((r) => r.kind === "OUT");
    return { day, firstIn: ins.at(-1) ?? null, lastOut: outs[0] ?? null, review: rows.some((r) => !trusted(r.verdict) && !r.id.startsWith("local-")), off: !isWorkday(day, daysOff) };
  });
  const recordedDays = byDay.filter((d) => d.firstIn || d.lastOut).length;

  const primaryIcon = suggested === "IN" ? LogIn : LogOut;
  const PrimaryIcon = busy?.kind === suggested ? Loader2 : settled ? CheckCircle2 : primaryIcon;
  const locked = busy !== null || settled;
  const toneText = { ok: "text-ok", warn: "text-warn", muted: "text-ink-soft" } as const;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-raised p-4 shadow-raised" aria-labelledby="attend-state">
        <div className="flex items-baseline justify-between gap-3 text-xs text-ink-soft">
          <p className="min-w-0 font-bold">{now ? dateLabel(now) : " "}</p>
          <p className="nums shrink-0 text-base font-bold text-ink" aria-label="الساعة الآن">{now ? clock12(riyadhClock(now)) : " "}</p>
        </div>
        <h2 id="attend-state" className="mt-3 text-xl font-bold leading-snug">{state.title}</h2>
        {state.note && <p className={`mt-1 text-sm font-bold ${toneText[state.tone]}`}>{state.note}</p>}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-sm text-ink-soft">
          {dayOff ? <><Coffee className="h-4 w-4 shrink-0 text-accent" aria-hidden />لا دوام اليوم</>
            : shiftRange ? <><CalendarCheck className="h-4 w-4 shrink-0 text-muted" aria-hidden />دوامك اليوم <bdi className="nums font-bold text-ink">{shiftRange}</bdi></>
            : <><CalendarCheck className="h-4 w-4 shrink-0 text-muted" aria-hidden />لم يُحدَّد وقت دوامك بعد</>}
          {daysOffLabel && !dayOff && <span className="text-xs text-muted">· راحتك {daysOffLabel}</span>}
        </p>
      </section>

      <div>
        <button type="button" onClick={() => void record(suggested)} disabled={locked} aria-busy={busy?.kind === suggested}
          className="flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-2xl bg-accent px-4 text-accent-ink shadow-raised transition active:scale-[0.98] disabled:opacity-70 motion-reduce:transition-none motion-reduce:active:scale-100">
          <span className="flex items-center gap-3 text-xl font-bold">
            <PrimaryIcon className={`h-7 w-7 ${busy?.kind === suggested ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
            {settled ? "تم" : suggested === "IN" ? "سجّل حضوري" : "سجّل انصرافي"}
          </span>
          <span className="text-xs font-bold opacity-80" aria-live="polite">{busy?.kind === suggested ? PHASE_LABEL[busy.phase] : settled ? " " : "اضغط مرة واحدة"}</span>
        </button>
        <button type="button" onClick={() => void record(other)} disabled={locked} aria-busy={busy?.kind === other}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold text-ink-soft hover:bg-hover disabled:opacity-60">
          {busy?.kind === other ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />{PHASE_LABEL[busy.phase]}</>
            : <>{other === "IN" ? <LogIn className="h-4 w-4" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}{other === "IN" ? "أو سجّل حضوري" : "أو سجّل انصرافي"}</>}
        </button>
      </div>

      {outcome && (
        <div ref={outcomeRef} tabIndex={-1} role={outcome.tone === "danger" ? "alert" : "status"}
          className={`rounded-2xl border p-4 outline-none ${
            outcome.tone === "ok" ? "border-ok/25 bg-ok-bg" : outcome.tone === "warn" ? "border-warn/25 bg-warn-bg" : outcome.tone === "info" ? "border-info/25 bg-info-bg" : "border-danger/25 bg-danger-bg"}`}>
          <p className={`flex items-start gap-2 text-base font-bold ${outcome.tone === "ok" ? "text-ok" : outcome.tone === "warn" ? "text-warn" : outcome.tone === "info" ? "text-info" : "text-danger"}`}>
            <outcome.icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /><span className="nums">{outcome.title}</span>
          </p>
          {outcome.body && <p className="mt-1 ps-7 text-sm leading-relaxed text-ink">{outcome.body}</p>}
          {outcome.retry && (
            <button type="button" onClick={() => void record(outcome.retry!)} disabled={busy !== null}
              className="ms-7 mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-raised px-4 text-sm font-bold text-ink shadow-raised disabled:opacity-60">
              <RotateCw className="h-4 w-4" aria-hidden />أعد المحاولة
            </button>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        يُقرأ موقع جوالك لحظة الضغط فقط، للتأكد أنك في المقهى. لا يُتتبَّع بعدها.
      </p>

      <section className="rounded-2xl border border-line bg-raised" aria-labelledby="attend-week">
        <h2 id="attend-week" className="flex items-baseline justify-between gap-2 px-4 pt-3 text-sm font-bold">
          ما سُجّل لك هذا الأسبوع
          <span className="text-xs font-normal text-muted">{recordedDays === 0 ? "لا تسجيل" : recordedDays === 1 ? "يوم واحد" : countNoun(recordedDays, DAY_AGO)}</span>
        </h2>
        <ul className="mt-2 divide-y divide-line border-t border-line">
          {byDay.map((d) => (
            <li key={d.day} className={`flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm ${d.day === today ? "bg-sunken/50" : ""}`}>
              <span className="min-w-0 shrink-0 font-bold">{d.day === today ? "اليوم" : weekdayLabel(d.day)} <span className="text-[11px] font-normal text-muted">{dayLabel(d.day)}</span></span>
              {d.firstIn || d.lastOut ? (
                <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 text-xs text-ink-soft">
                  <span>حضور <bdi className="nums font-bold text-ink">{d.firstIn ? at12(d.firstIn.at) : "—"}</bdi></span>
                  <span>انصراف <bdi className="nums font-bold text-ink">{d.lastOut && (!d.firstIn || d.lastOut.at > d.firstIn.at) ? at12(d.lastOut.at) : "—"}</bdi></span>
                  {d.review && <span className="text-[11px] text-warn">يراجعه المدير</span>}
                </span>
              ) : <span className={`text-xs ${d.off ? "text-accent" : "text-muted"}`}>{d.off ? "راحة" : d.day === today ? "لم يُسجَّل بعد" : "لا تسجيل"}</span>}
            </li>
          ))}
        </ul>
      </section>

      {week.length > 0 && (
        <section className="rounded-2xl border border-line bg-raised">
          <button type="button" onClick={() => setShowWeek((x) => !x)} aria-expanded={showWeek} className="flex min-h-12 w-full items-center justify-between gap-2 px-4 text-sm font-bold">
            دوامي في الأيام القادمة
            <ChevronUp className={`h-4 w-4 text-muted transition-transform motion-reduce:transition-none ${showWeek ? "" : "rotate-180"}`} aria-hidden />
          </button>
          {showWeek && (
            <ul className="divide-y divide-line border-t border-line">
              {week.map((d) => (
                <li key={d.day} className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${d.day === today ? "font-bold" : ""}`}>
                  <span>{d.day === today ? "اليوم" : `${weekdayLabel(d.day)} ${dayLabel(d.day)}`}</span>
                  <span className={d.off ? "text-accent" : "nums"}>{d.off ? "راحة" : d.range ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(period || slip) && (
        <div>
          <button type="button" onClick={() => setDetails((x) => !x)} aria-expanded={details}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-3 text-xs font-bold text-ink-soft hover:bg-hover">
            {details ? <ChevronUp className="h-4 w-4" aria-hidden /> : <Info className="h-4 w-4" aria-hidden />}
            {details ? "أخفِ" : slip ? "ملخّص الشهر والقسيمة" : "ملخّص الشهر"}
          </button>
          {details && (
            <div className="mt-3 space-y-4">
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
                  <p className="mt-2 text-[11px] leading-relaxed text-muted">يُحسب التأخير من أول حضور في اليوم. إن كان لك عذر فأرسله من «طلباتي».</p>
                </section>
              )}
              {slip && (
                <section className="rounded-2xl border border-line bg-raised p-4" aria-label="قسيمة الراتب">
                  <h2 className="text-xs font-bold text-ink-soft">قسيمة راتب {monthLabel(slip.month)}</h2>
                  <dl className="mt-2 space-y-1.5 text-sm">
                    <Row label="الراتب" minor={slip.baseMinor} />
                    {slip.additionsMinor > 0 && <Row label="إضافات" minor={slip.additionsMinor} />}
                    <Row label="خصومات" minor={slip.deductionsMinor} minus />
                    {slip.advancesMinor > 0 && <Row label="سلف" minor={slip.advancesMinor} minus />}
                    <Row label="المستحق" minor={slip.dueMinor} strong />
                    <Row label="حُوّل لك" minor={slip.paidMinor} />
                    {slip.remainingMinor !== null && slip.remainingMinor > 0 && <Row label="الباقي لك" minor={slip.remainingMinor} strong />}
                  </dl>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, minor, minus, strong }: { label: string; minor: number | null; minus?: boolean; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "border-t border-line pt-1.5 font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd className="nums">{minor === null ? <span className="text-muted">غير معروف</span> : <>{minus && minor > 0 ? "− " : ""}{formatRiyalsDisplay(minor)} ريال</>}</dd>
    </div>
  );
}
