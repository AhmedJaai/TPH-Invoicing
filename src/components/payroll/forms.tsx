"use client";

/**
 * نماذجُ الموظّفين والمسيّر — كلُّها ترسل معرّفاتٍ ونصوصاً، والخادمُ يقرأ المالَ هللاتٍ ويحسب.
 * والحاسبةُ هنا معاينةٌ للعين فقط: الخصمُ الذي يُحسب في المسيّر يحسبه الخادم من الدقائق.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Copy, Link2, MessageCircle, Plus, X } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyals, formatRiyalsDisplay, parseRiyals } from "@/lib/money";
import { countNoun, EMPLOYEE } from "@/lib/arabic";
import {
  ADJUSTMENT_HINT, ADJUSTMENT_LABEL, ADJUSTMENT_KINDS, DAYS_PER_MONTH, divRound, PURPOSE_HINT, PURPOSE_LABEL, PURPOSES, unitValues,
} from "@/lib/payroll/calc";
import { WEEKDAY_LABEL } from "@/lib/payroll/attendance";
import { earlyCode, lateCode, MANUAL_CODES, ORDINAL, penaltyLabel, RULES } from "@/lib/payroll/saudi-rules";
import type { PayrollAdjustmentKind, PayrollLinkPurpose } from "@/db/schema";
import type { EmployeeFormValues } from "@/lib/payroll/form-defaults";
import { buttonClass, fieldClass } from "../ui-tokens";
import { ConfirmAction, toast } from "../ui-client";

/* ─────────────── أداةٌ مشتركة ─────────────── */

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send<T extends { message?: string }>(url: string, body: unknown, fallback = "حُفظ"): Promise<T | null> {
    if (busy) return null;
    setBusy(true);
    setError(null);
    const r = await postJson<T>(url, body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return null; }
    toast({ tone: "ok", title: r.data.message ?? fallback });
    router.refresh();
    return r.data;
  }
  return { busy, error, send, setError };
}

const field = fieldClass("md", false);
const label = "block text-xs font-bold text-ink-soft";

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p> : null;
}

/* ─────────────── الموظّف ─────────────── */

export function EmployeeForm({ initial }: { initial: EmployeeFormValues }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const { busy, error, send } = useSend();
  const isNew = !initial.id;
  const set = <K extends keyof EmployeeFormValues>(k: K, value: EmployeeFormValues[K]) => setV((x) => ({ ...x, [k]: value }));
  const toggleDay = (d: number) => set("daysOff", v.daysOff.includes(String(d)) ? v.daysOff.replace(String(d), "") : v.daysOff + String(d));

  async function save() {
    const grace = Number(v.lateGraceMinutes || "0");
    const r = await send<{ id?: string; message?: string }>("/api/payroll/employee", {
      action: isNew ? "create" : "update",
      ...(isNew ? {} : { id: initial.id }),
      name: v.name, kind: v.kind, jobTitle: v.jobTitle, phone: v.phone, nationalId: v.nationalId,
      bankBeneficiaryId: v.bankBeneficiaryId, iban: v.iban, hiredOn: v.hiredOn, leftOn: v.leftOn || null,
      shiftStart: v.shiftStart || null, shiftHours: v.shiftHours, lateGraceMinutes: Number.isInteger(grace) ? grace : 0,
      daysOff: v.daysOff, note: v.note,
      ...(isNew ? { salary: v.salary ?? "" } : {}),
    });
    /* الموظّفُ الجديد تُفتح صفحتُه: راتبُه ورابطُ حضوره ووثائقُه هناك */
    if (r?.id && isNew) router.push(`/payroll/employee/${r.id}`);
  }

  const ready = v.name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(v.hiredOn);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={label}>الاسم<input className={`${field} mt-1.5`} value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required /></label>
        <label className={label}>نوع العمل
          <select className={`${field} mt-1.5`} value={v.kind} onChange={(e) => set("kind", e.target.value === "PART_TIME" ? "PART_TIME" : "MONTHLY")}>
            <option value="MONTHLY">دوام كامل، راتب شهري</option>
            <option value="PART_TIME">جزئي، بالساعة ويُحوَّل أسبوعياً</option>
          </select>
          {!isNew && v.kind !== initial.kind && <span className="mt-1 block text-[11px] font-bold text-warn">تغيير النوع يجعل الرواتب المكتوبة {v.kind === "PART_TIME" ? "أجر ساعة" : "راتباً شهرياً"}. راجعها بعد الحفظ.</span>}
        </label>
        <label className={label}>المسمى الوظيفي <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={v.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} maxLength={60} placeholder="باريستا" /></label>
        {isNew && (
          <label className={label}>{v.kind === "MONTHLY" ? "الراتب الشهري (ريال)" : "أجر الساعة (ريال)"} <span className="font-normal text-muted">(تعدّله لاحقاً من صفحته)</span>
            <input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="decimal" value={v.salary ?? ""} onChange={(e) => set("salary", e.target.value)} placeholder="3000" />
          </label>
        )}
        <label className={label}>يوم المباشرة<input type="date" dir="ltr" className={`${field} mt-1.5`} value={v.hiredOn} onChange={(e) => set("hiredOn", e.target.value)} required /></label>
        <label className={label}>يوم الخروج <span className="font-normal text-muted">(إن ترك العمل)</span><input type="date" dir="ltr" className={`${field} mt-1.5`} value={v.leftOn} onChange={(e) => set("leftOn", e.target.value)} /></label>
        <label className={label}>رقم المستفيد في البنك <span className="font-normal text-muted">(BEN ID)</span><input className={`${field} nums mt-1.5`} dir="ltr" inputMode="numeric" value={v.bankBeneficiaryId} onChange={(e) => set("bankBeneficiaryId", e.target.value.replace(/\D/g, ""))} placeholder="1129311518" /></label>
        <label className={label}>الآيبان <span className="font-normal text-muted">(اختياري)</span><input className={`${field} nums mt-1.5`} dir="ltr" value={v.iban} onChange={(e) => set("iban", e.target.value)} placeholder="SA…" /></label>
        <label className={label}>الجوال <span className="font-normal text-muted">(لإرسال رابط الحضور)</span><input className={`${field} nums mt-1.5`} dir="ltr" inputMode="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="9665…" /></label>
        <label className={label}>رقم الهوية أو الإقامة <span className="font-normal text-muted">(اختياري)</span><input className={`${field} nums mt-1.5`} dir="ltr" inputMode="numeric" value={v.nationalId} onChange={(e) => set("nationalId", e.target.value.replace(/\D/g, ""))} /></label>
        <label className={label}>بداية الدوام <span className="font-normal text-muted">(لحساب التأخير من الحضور)</span><input type="time" dir="ltr" className={`${field} mt-1.5`} value={v.shiftStart} onChange={(e) => set("shiftStart", e.target.value)} /></label>
        <label className={label}>طول الدوام (ساعات)<input className={`${field} nums mt-1.5 text-end`} dir="ltr" value={v.shiftHours} onChange={(e) => set("shiftHours", e.target.value)} placeholder="8" /></label>
        <label className={label}>دقائق سماح التأخير<input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="numeric" value={v.lateGraceMinutes} onChange={(e) => set("lateGraceMinutes", e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="0" /></label>
      </div>
      <fieldset className="mt-4">
        <legend className={label}>أيام الراحة</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {WEEKDAY_LABEL.map((d, i) => (
            <label key={d} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs ${v.daysOff.includes(String(i)) ? "border-accent-line bg-accent-soft/60 font-bold" : "border-line"}`}>
              <input type="checkbox" checked={v.daysOff.includes(String(i))} onChange={() => toggleDay(i)} />{d}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={`${label} mt-4`}>ملاحظة <span className="font-normal text-muted">(اختياري)</span><textarea className={`${field} mt-1.5 min-h-16 py-2`} value={v.note} onChange={(e) => set("note", e.target.value)} maxLength={300} /></label>
      <ErrorLine error={error} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass("primary")} disabled={busy || !ready} aria-busy={busy}>{isNew ? "أضف الموظف" : "احفظ التعديل"}</button>
        <p className="min-w-0 flex-1 basis-60 text-[11px] leading-relaxed text-muted">رقم المستفيد هو ما يظهر بعد «BEN ID» في وصف الحوالة. به تُقترح حوالاته تلقائياً.</p>
      </div>
    </form>
  );
}

/* ─────────────── الراتب من شهر ─────────────── */

export function RateForm({ employeeId, kind, month }: { employeeId: string; kind: "MONTHLY" | "PART_TIME"; month: string }) {
  const [fromMonth, setFromMonth] = useState(month);
  const [amount, setAmount] = useState("");
  const { busy, error, send } = useSend();
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await send("/api/payroll/employee", { action: "rate", id: employeeId, fromMonth, amount })) setAmount("");
    }}>
      <label className={label}>من شهر<input type="month" dir="ltr" className={`${field} mt-1.5`} value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} required /></label>
      <label className={label}>{kind === "MONTHLY" ? "الراتب الشهري (ريال)" : "أجر الساعة (ريال)"}<input className={`${field} nums mt-1.5 w-36 text-end`} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3500" required /></label>
      <button type="submit" className={buttonClass("primary")} disabled={busy || !amount.trim() || !fromMonth} aria-busy={busy}>احفظ</button>
      <div className="basis-full"><ErrorLine error={error} /></div>
    </form>
  );
}

/* ─────────────── بندُ الشهر ─────────────── */

export function AdjustmentForm({ employeeId, month, loanMinor }: { employeeId: string; month: string; loanMinor: number }) {
  const [kind, setKind] = useState<PayrollAdjustmentKind>("DEDUCTION");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { busy, error, send } = useSend();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await send("/api/payroll/entry", { action: "adjust", employeeId, month, kind, amount, note })) { setAmount(""); setNote(""); }
    }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,1fr)]">
        <label className={label}>النوع
          <select className={`${field} mt-1.5`} value={kind} onChange={(e) => setKind(ADJUSTMENT_KINDS.find((k) => k === e.target.value) ?? "DEDUCTION")}>
            <optgroup label="ينقص الراتب">{(["DEDUCTION", "FINE", "ADVANCE", "LOAN_REPAYMENT"] as const).map((k) => <option key={k} value={k}>{ADJUSTMENT_LABEL[k]}</option>)}</optgroup>
            <optgroup label="يزيد الراتب">{(["BONUS", "OVERTIME", "ALLOWANCE"] as const).map((k) => <option key={k} value={k}>{ADJUSTMENT_LABEL[k]}</option>)}</optgroup>
            <optgroup label="خارج راتب الشهر"><option value="LOAN_GIVEN">{ADJUSTMENT_LABEL.LOAN_GIVEN}</option></optgroup>
            <optgroup label="دُفع له"><option value="PAID_OUTSIDE">{ADJUSTMENT_LABEL.PAID_OUTSIDE}</option></optgroup>
          </select>
        </label>
        <label className={label}>المبلغ (ريال)<input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" required /></label>
        <label className={label}>السبب <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={kind === "FINE" ? "مخالفة بلدية: عدم لبس القفازات" : ""} /></label>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">{ADJUSTMENT_HINT[kind]}{kind === "LOAN_REPAYMENT" && <> · رصيد سلفه الآن {formatRiyalsDisplay(loanMinor)} ريال</>}</p>
      <ErrorLine error={error} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || !amount.trim()} aria-busy={busy}><Plus className="h-3.5 w-3.5" aria-hidden />أضف</button>
    </form>
  );
}

/* ─────────────── اليوم: تأخيرٌ وغيابٌ وإجازة، مع الحاسبة ─────────────── */

export function DayForm({ employeeId, salaryMinor, shiftMinutes, graceMinutes, defaultDay }: {
  employeeId: string;
  /** راتبُ الشهر — للحاسبة. `null` لم يُكتب. */
  salaryMinor: number | null;
  shiftMinutes: number;
  graceMinutes: number;
  defaultDay: string;
}) {
  const [day, setDay] = useState(defaultDay);
  const [kind, setKind] = useState<"LATE" | "EARLY" | "ABSENT" | "LEAVE">("LATE");
  const [minutes, setMinutes] = useState("");
  const [disrupted, setDisrupted] = useState(false);
  const [note, setNote] = useState("");
  const { busy, error, send } = useSend();
  const n = Number(minutes);
  const byMinutes = kind === "LATE" || kind === "EARLY";
  const valid = byMinutes && Number.isInteger(n) && n > 0;
  const withinGrace = kind === "LATE" && valid && n <= graceMinutes;
  const units = salaryMinor !== null ? unitValues(salaryMinor, shiftMinutes) : null;
  /* أجرُ الوقت للعين — والجزاءُ ومرّتُه يحسبهما الخادم من سجلّه */
  const timeWage = units === null ? null : byMinutes ? (valid && !withinGrace ? divRound(salaryMinor! * n, DAYS_PER_MONTH * shiftMinutes) : 0) : kind === "ABSENT" ? units.dayMinor : 0;
  const rule = kind === "LATE" && valid && !withinGrace ? RULES[lateCode(n, disrupted)] : kind === "EARLY" && valid ? RULES[earlyCode(n)] : kind === "ABSENT" ? RULES["1/11"] : null;

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await send("/api/payroll/entry", { action: "day", employeeId, day, kind, minutes: byMinutes ? n : null, disrupted: kind === "LATE" ? disrupted : undefined, note })) { setMinutes(""); setNote(""); setDisrupted(false); }
    }}>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="حال اليوم">
        {([["LATE", "تأخر"], ["EARLY", "انصرف مبكراً"], ["ABSENT", "غاب دون إذن"], ["LEAVE", "إجازة أو عذر مقبول"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`min-h-10 rounded-lg border px-3 text-xs font-bold ${kind === k ? "border-accent bg-accent text-accent-ink" : "border-line bg-raised text-ink-soft hover:bg-hover"}`}>{l}</button>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <label className={label}>اليوم<input type="date" dir="ltr" className={`${field} mt-1.5`} value={day} onChange={(e) => setDay(e.target.value)} required /></label>
        {byMinutes && <label className={label}>كم دقيقة<input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="15" required /></label>}
        <label className={label}>ملاحظة <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
      </div>
      {kind === "LATE" && (
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs font-bold text-ink-soft">
          <input type="checkbox" checked={disrupted} onChange={(e) => setDisrupted(e.target.checked)} />
          تأخره عطّل زملاءه (مثلاً لم يُفتح المقهى أو انتظره من يسلّمه الوردية) — بند أشد في اللائحة
        </label>
      )}
      <div className="flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
        <Calculator className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        {units === null ? <span>اكتب راتب الموظف ليحسب الخصم.</span>
          : kind === "LEAVE" ? <span>الإجازة أو العذر المقبول لا يُخصم عليه.</span>
          : withinGrace ? <span>في حدود السماح ({graceMinutes} دقيقة)، فلا يُحسب.</span>
          : <span className="space-y-1">
              <span className="block">
                {byMinutes ? <>أجر الدقائق: <strong className="text-ink">{formatRiyalsDisplay(timeWage ?? 0)}</strong> ريال</> : <>أجر اليوم: <strong className="text-ink">{formatRiyalsDisplay(units.dayMinor)}</strong> ريال</>}
                {" "}(الدقيقة {formatRiyalsDisplay(units.minuteMinor)} · اليوم {formatRiyalsDisplay(units.dayMinor)})
              </span>
              {rule && (
                <span className="block">
                  وفوقه جزاء البند {rule.code} من لائحة تنظيم العمل «{rule.label}»: {rule.ladder.map((p, i) => `${ORDINAL[i]} ${penaltyLabel(p)}`).join("، ")}.
                  تُحسب المرة من سجله خلال ١٨٠ يوماً.
                </span>
              )}
            </span>}
      </div>
      <ErrorLine error={error} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || (byMinutes && !(n > 0))} aria-busy={busy}>سجّل اليوم</button>
    </form>
  );
}

/* ─────────────── مخالفةٌ من بقيّة جدول اللائحة ─────────────── */

export function ViolationForm({ employeeId, defaultDay }: { employeeId: string; defaultDay: string }) {
  const [code, setCode] = useState(MANUAL_CODES[0]);
  const [day, setDay] = useState(defaultDay);
  const [note, setNote] = useState("");
  const { busy, error, send } = useSend();
  const rule = RULES[code];
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await send("/api/payroll/entry", { action: "violation", employeeId, day, code, note })) setNote("");
    }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <label className={label}>المخالفة
          <select className={`${field} mt-1.5`} value={code} onChange={(e) => setCode(MANUAL_CODES.find((c) => c === e.target.value) ?? MANUAL_CODES[0])}>
            {MANUAL_CODES.map((c) => <option key={c} value={c}>{RULES[c].label} ({c})</option>)}
          </select>
        </label>
        <label className={label}>اليوم<input type="date" dir="ltr" className={`${field} mt-1.5`} value={day} onChange={(e) => setDay(e.target.value)} required /></label>
      </div>
      <label className={label}>ما حدث <span className="font-normal text-muted">(اختياري)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
      <p className="text-[11px] leading-relaxed text-muted">الجزاء من الجدول: {rule.ladder.map((p, i) => `${ORDINAL[i]} ${penaltyLabel(p)}`).join("، ")}. ولا يزيد جزاء المخالفة ولا مجموع الشهر على أجر خمسة أيام.</p>
      <ErrorLine error={error} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy} aria-busy={busy}>سجّل المخالفة</button>
    </form>
  );
}

/* ─────────────── أسبوعُ الجزئيّ ─────────────── */

export function WeekForm({ employeeId, defaultDay, suggestedHours }: { employeeId: string; defaultDay: string; suggestedHours?: string }) {
  const [day, setDay] = useState(defaultDay);
  const [hours, setHours] = useState(suggestedHours ?? "");
  const [amount, setAmount] = useState("");
  const { busy, error, send } = useSend();
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (await send("/api/payroll/entry", { action: "week", employeeId, day, hours: hours || undefined, amount: amount || undefined })) { setHours(""); setAmount(""); }
    }}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <label className={label}>أي يوم في الأسبوع<input type="date" dir="ltr" className={`${field} mt-1.5`} value={day} onChange={(e) => setDay(e.target.value)} required /></label>
        <label className={label}>الساعات<input className={`${field} nums mt-1.5 text-end`} dir="ltr" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="24 أو 22:30" /></label>
        <label className={label}>أو المبلغ مباشرة (ريال)<input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="اختياري" /></label>
      </div>
      <p className="text-[11px] text-muted">الأسبوع من الأحد إلى السبت، ويُحسب لشهر يوم السبت. بالساعات يُضرب في أجر الساعة.</p>
      <ErrorLine error={error} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || (!hours.trim() && !amount.trim())} aria-busy={busy}>سجّل الأسبوع</button>
    </form>
  );
}

/* ─────────────── توزيعُ حوالة ─────────────── */

export interface LinkOption { id: string; name: string }

/** ما بقي لكلّ موظّفٍ عن شهر — لملء التوزيع منه. */
export type OwedByMonth = Readonly<Record<string, readonly { employeeId: string; remainingMinor: number }[]>>;

interface Part { key: number; employeeId: string; purpose: PayrollLinkPurpose; month: string; amount: string }

/**
 * توزيعُ حوالةٍ على موظّفٍ أو أكثر — سطرٌ لكلّ جزء، والمجموعُ يُرى وهو يُكتب أمام باقي الحوالة.
 * يُرسَل كلُّه مرّةً واحدة والخادمُ يكتبه كلَّه أو يردّه كلَّه (`splitTransfer`). المبالغُ نصوصٌ هنا،
 * وما يُجمع للعين يُقرأ هللاتٍ صحيحة.
 */
export function LinkTransferForm({ tx, employees, defaults, owed }: {
  tx: { id: string; freeMinor: number; freeText: string; viaOwner: boolean };
  employees: readonly LinkOption[];
  defaults: { employeeId: string; month: string; purpose: PayrollLinkPurpose };
  owed?: OwedByMonth;
}) {
  const [parts, setParts] = useState<Part[]>([{ key: 0, employeeId: defaults.employeeId, purpose: defaults.purpose, month: defaults.month, amount: "" }]);
  const [note, setNote] = useState("");
  const { busy, error, send, setError } = useSend();
  const nextKey = () => Math.max(0, ...parts.map((p) => p.key)) + 1;
  const update = (key: number, patch: Partial<Part>) => setParts((xs) => xs.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const parsed = parts.map((p) => (p.amount.trim() ? parseRiyals(p.amount) : null));
  const badAmount = parts.some((p, i) => p.amount.trim() !== "" && (parsed[i] === null || parsed[i]! <= 0));
  const blanks = parts.filter((p) => !p.amount.trim()).length;
  const typed = parsed.reduce<number>((s, a) => s + (a ?? 0), 0);
  /* سطرٌ واحد بلا مبلغ يأخذ الباقي */
  const total = blanks === 1 ? tx.freeMinor : typed;
  const left = tx.freeMinor - total;
  const over = left < 0 || (blanks === 1 && typed >= tx.freeMinor);
  const ready = parts.every((p) => p.employeeId && p.month) && !badAmount && blanks <= 1 && !over && total > 0;
  const fillMonth = parts[0]?.month ?? defaults.month;
  const owedRows = (owed?.[fillMonth] ?? []).filter((o) => o.remainingMinor > 0);

  /** يملأ السطور بما بقي لكلّ موظّفٍ عن الشهر، حتى ينفد باقي الحوالة. */
  function fillOwed() {
    let room = tx.freeMinor;
    const rows: Part[] = [];
    let key = 0;
    for (const o of owedRows) {
      if (room <= 0) break;
      const take = Math.min(room, o.remainingMinor);
      rows.push({ key: key++, employeeId: o.employeeId, purpose: "SALARY", month: fillMonth, amount: formatRiyals(take) });
      room -= take;
    }
    if (rows.length > 0) setParts(rows);
    else setError("لا مستحقات باقية لهذا الشهر.");
  }

  async function save() {
    const r = await send("/api/payroll/link", {
      action: "split", bankTransactionId: tx.id,
      parts: parts.map((p) => ({ employeeId: p.employeeId, month: p.month, purpose: p.purpose, amount: p.amount.trim() || undefined, note })),
    });
    if (r) { setParts([{ key: 0, employeeId: "", purpose: "SALARY", month: defaults.month, amount: "" }]); setNote(""); }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) void save(); }}>
      <div className="flex flex-wrap items-center gap-2">
        {owedRows.length > 0 && (
          <button type="button" className={buttonClass("subtle", "sm")} onClick={fillOwed}>
            املأ بما بقي لهم عن الشهر ({countNoun(owedRows.length, EMPLOYEE)})
          </button>
        )}
        <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setParts((xs) => [...xs, { key: nextKey(), employeeId: "", purpose: xs[xs.length - 1]?.purpose ?? "SALARY", month: xs[xs.length - 1]?.month ?? defaults.month, amount: "" }])}>
          <Plus className="h-3.5 w-3.5" aria-hidden />سطر آخر
        </button>
      </div>

      <ul className="space-y-2">
        {parts.map((p, i) => (
          <li key={p.key} className="grid grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-line bg-sunken/40 p-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className={label}>{i === 0 ? "لمن" : <span className="sm:sr-only">لمن</span>}
              <select className={`${field} mt-1`} value={p.employeeId} onChange={(e) => update(p.key, { employeeId: e.target.value })} required>
                <option value="">— اختر —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className={label}>{i === 0 ? "الغرض" : <span className="sm:sr-only">الغرض</span>}
              <select className={`${field} mt-1`} value={p.purpose} onChange={(e) => update(p.key, { purpose: PURPOSES.find((x) => x === e.target.value) ?? "SALARY" })}>
                {PURPOSES.map((x) => <option key={x} value={x}>{PURPOSE_LABEL[x]}</option>)}
              </select>
            </label>
            <label className={label}>{i === 0 ? "عن شهر" : <span className="sm:sr-only">عن شهر</span>}
              <input type="month" dir="ltr" className={`${field} mt-1`} value={p.month} onChange={(e) => update(p.key, { month: e.target.value })} required />
            </label>
            <label className={label}>{i === 0 ? "المبلغ (ريال)" : <span className="sm:sr-only">المبلغ</span>}
              <input className={`${field} nums mt-1 text-end ${p.amount.trim() && (parsed[i] === null || parsed[i]! <= 0) ? "border-danger" : ""}`} dir="ltr" inputMode="decimal"
                value={p.amount} onChange={(e) => update(p.key, { amount: e.target.value })} placeholder={parts.length === 1 ? tx.freeText : "0"} />
            </label>
            <span className="flex gap-1 sm:pb-0.5">
              {!p.amount.trim() || left !== 0 ? (
                <button type="button" className={buttonClass("quiet", "sm")} title="الباقي لهذا السطر"
                  onClick={() => update(p.key, { amount: formatRiyals(Math.max(0, tx.freeMinor - (typed - (parsed[i] ?? 0)))) })}>الباقي</button>
              ) : null}
              {parts.length > 1 && (
                <button type="button" className={buttonClass("quiet", "sm")} aria-label={`احذف السطر ${i + 1}`} onClick={() => setParts((xs) => xs.filter((x) => x.key !== p.key))}><X className="h-3.5 w-3.5" aria-hidden /></button>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-bold ${over ? "bg-danger-bg text-danger" : left === 0 ? "bg-ok-bg text-ok" : "bg-sunken text-ink-soft"}`} role="status">
        <span>وُزّع <span className="nums">{formatRiyalsDisplay(Math.max(0, total))}</span> من <span className="nums">{tx.freeText}</span></span>
        <span>{over ? `زاد ${formatRiyalsDisplay(-left)} على الحوالة` : left === 0 ? "الحوالة كلها موزّعة" : tx.viaOwner ? `يبقى ${formatRiyalsDisplay(left)} لك شخصياً` : `يبقى ${formatRiyalsDisplay(left)} غير موزّع`}</span>
      </div>

      <label className={label}>ملاحظة <span className="font-normal text-muted">(اختياري، لكل السطور)</span><input className={`${field} mt-1.5`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={parts.some((p) => p.purpose === "INVOICE") ? "فاتورة المراعي رقم …" : ""} /></label>
      {parts.length === 1 && <p className="text-[11px] leading-relaxed text-muted">{PURPOSE_HINT[parts[0].purpose]}</p>}
      {badAmount && <p className="text-[11px] font-bold text-danger">مبلغ غير مفهوم في أحد السطور.</p>}
      {blanks > 1 && <p className="text-[11px] font-bold text-warn">اكتب مبلغ كل سطر، أو اترك سطراً واحداً فارغاً ليأخذ الباقي.</p>}
      <ErrorLine error={error} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || !ready} aria-busy={busy}>
        <Link2 className="h-3.5 w-3.5" aria-hidden />{parts.length === 1 ? "وزّع" : parts.length === 2 ? "وزّع على جزأين" : `وزّع على ${parts.length} أجزاء`}
      </button>
    </form>
  );
}

export function LinkSuggestedButton({ month, txIds }: { month: string; txIds: readonly string[] }) {
  const { busy, error, send } = useSend();
  return (
    <div>
      <button type="button" className={buttonClass("primary", "sm")} disabled={busy || txIds.length === 0} aria-busy={busy}
        onClick={() => void send("/api/payroll/link", { action: "suggested", month, txIds })}>
        <Link2 className="h-3.5 w-3.5" aria-hidden />اربط المقترحات كلها رواتب ({txIds.length})
      </button>
      <ErrorLine error={error} />
    </div>
  );
}

/* ─────────────── رابطُ الحضور ─────────────── */

export function CheckinLinkPanel({ employeeId, name, phone, hasLink }: { employeeId: string; name: string; phone: string | null; hasLink: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const { busy, error, send } = useSend();
  const issue = async () => {
    const r = await send<{ token?: string; message?: string }>("/api/payroll/employee", { action: "link-issue", id: employeeId });
    if (r?.token) setUrl(`${window.location.origin}/a/${r.token}`);
  };
  const wa = url ? `https://wa.me/${(phone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(`أهلاً ${name}، هذا رابط تسجيل حضورك في ذا بوبليك هاوس. افتحه من جوالك عند وصولك وعند انصرافك، واسمح له بقراءة الموقع:\n${url}`)}` : null;
  return (
    <div className="space-y-2">
      {url ? (
        <div className="rounded-xl border border-accent-line bg-accent-soft/40 p-3">
          <p className="text-xs font-bold">الرابط الجديد — يظهر الآن مرة واحدة فقط</p>
          <p className="nums mt-1 break-all text-[11px] text-ink-soft" dir="ltr">{url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => { void navigator.clipboard.writeText(url).then(() => toast({ tone: "ok", title: "نُسخ الرابط" })); }}><Copy className="h-3.5 w-3.5" aria-hidden />انسخ</button>
            {wa && <a className={buttonClass("secondary", "sm")} href={wa} target="_blank" rel="noreferrer"><MessageCircle className="h-3.5 w-3.5" aria-hidden />أرسله واتساب</a>}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass(hasLink ? "secondary" : "primary", "sm")} disabled={busy} aria-busy={busy} onClick={() => void issue()}>
            <Link2 className="h-3.5 w-3.5" aria-hidden />{hasLink ? "أنشئ رابطاً جديداً (يلغي القديم)" : "أنشئ رابط الحضور"}
          </button>
          {hasLink && (
            <button type="button" className={buttonClass("danger", "sm")} disabled={busy} onClick={() => void send("/api/payroll/employee", { action: "link-revoke", id: employeeId })}>ألغِ الرابط</button>
          )}
        </div>
      )}
      <ErrorLine error={error} />
    </div>
  );
}

/* ─────────────── موقعُ المقهى وشبكتُه ─────────────── */

export function AttendancePlaceForm({ current }: { current: { lat: string; lng: string; radiusM: number } | null }) {
  const [lat, setLat] = useState(current?.lat ?? "");
  const [lng, setLng] = useState(current?.lng ?? "");
  const [radius, setRadius] = useState(String(current?.radiusM ?? 120));
  const [locating, setLocating] = useState(false);
  const { busy, error, send, setError } = useSend();

  function here() {
    if (!("geolocation" in navigator)) { setError("هذا المتصفح لا يقرأ الموقع."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setLat(p.coords.latitude.toFixed(6)); setLng(p.coords.longitude.toFixed(6)); },
      () => { setLocating(false); setError("لم يُسمح بقراءة الموقع. اسمح له من إعدادات المتصفح، أو الصق الإحداثيات."); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }
  /** «21.61, 39.15» أو رابطُ خرائط جوجل فيه «@21.61,39.15». */
  function paste(text: string) {
    const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(text);
    if (m) { setLat(m[1]); setLng(m[2]); }
  }
  const ready = /^-?\d{1,2}(\.\d+)?$/.test(lat) && /^-?\d{1,3}(\.\d+)?$/.test(lng);
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      void send("/api/payroll/attendance", { action: "place", lat: Number(lat), lng: Number(lng), radiusM: Number(radius) || 120 });
    }}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={here} disabled={locating} aria-busy={locating}>خذ موقعي الآن (وأنا في المقهى)</button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <label className={label}>خط العرض<input className={`${field} nums mt-1.5`} dir="ltr" value={lat} onChange={(e) => setLat(e.target.value)} onPaste={(e) => { paste(e.clipboardData.getData("text")); }} placeholder="21.6136" /></label>
        <label className={label}>خط الطول<input className={`${field} nums mt-1.5`} dir="ltr" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="39.1567" /></label>
        <label className={label}>نصف القطر (متر)<input className={`${field} nums mt-1.5 text-end`} dir="ltr" inputMode="numeric" value={radius} onChange={(e) => setRadius(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
      </div>
      <p className="text-[11px] text-muted">يمكنك لصق الإحداثيات من خرائط جوجل (مثل 21.6136, 39.1567) في الخانة الأولى.</p>
      <ErrorLine error={error} />
      <button type="submit" className={buttonClass("primary", "sm")} disabled={busy || !ready} aria-busy={busy}>احفظ الموقع</button>
    </form>
  );
}

/* ─────────────── حذفُ موظّفٍ أُضيف خطأً ─────────────── */

export function DeleteEmployeeButton({ employeeId, name }: { employeeId: string; name: string }) {
  const router = useRouter();
  return (
    <ConfirmAction
      label="احذف الموظف"
      title={`حذف ${name}`}
      consequence="يُحذف الموظف ورواتبه المكتوبة. لا يُحذف من له حوالات أو بنود أو حضور: لمن ترك العمل اكتب يوم خروجه بدلاً من الحذف."
      acknowledgement="أضفته خطأً، وليس له سجلّ"
      confirmLabel="احذفه"
      onConfirm={async () => {
        const r = await postJson<{ message?: string }>("/api/payroll/employee", { action: "delete", id: employeeId });
        if (!r.ok) { toast({ tone: "danger", title: r.error }); return false; }
        toast({ tone: "ok", title: r.data.message ?? "حُذف" });
        router.push("/payroll/employees");
        return true;
      }}
    />
  );
}

/* ─────────────── حوالةُ «راتب» ليست لموظّف ─────────────── */

export function NotPayrollButton({ txId }: { txId: string }) {
  const { busy, send } = useSend();
  return (
    <button type="button" className={buttonClass("quiet", "sm")} disabled={busy} aria-busy={busy}
      onClick={() => void send("/api/signal", { key: `payroll-tx:${txId}`, action: "dismiss" }, "أُخفيت الحوالة. تعيدها من «ما قرّرته»")}>
      ليست لموظف — أخفها
    </button>
  );
}
