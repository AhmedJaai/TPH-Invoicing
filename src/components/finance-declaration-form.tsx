"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

export interface SpreadCandidate { id: string; day: string; dayLabel: string; amountText: string; label: string; spread: boolean }

const KINDS = [
  { value: "OFF_BOOK", label: "مصروف خارج الكشف يتكرر كل شهر", hint: "كراتب يُدفع نقداً أو إيجار يُدفع من حساب شخصي. اكتب مبلغ الشهر الواحد." },
  { value: "SPREAD", label: "دفعة في الكشف تغطي عدة أشهر", hint: "كإيجار دُفع مرة واحدة عن ستة أشهر، فيُوزَّع بالتساوي على أشهره." },
  { value: "NONE", label: "لا يوجد في هذه الأشهر", hint: "لم يكن على المقهى هذا المصروف في تلك الأشهر، فلا يُعدّ ناقصاً." },
  { value: "MEMO", label: "رقم للعلم لا يُطرح من الربح", hint: "كإهلاك جهاز أو أصل اشتُري قبل الافتتاح. يظهر تحت الربح ومعه «الربح بعد الإهلاك»، ولا يُنقص الربح. اكتب مبلغ الشهر الواحد." },
] as const;
type Kind = (typeof KINDS)[number]["value"];

/**
 * ما لا يراه الكشف — يقوله صاحبُ المقهى مرّةً فيدخل قائمةَ الدخل باسمه «بإقرار المالك».
 * لا يُنشئ مصروفاً ولا دفعة: طبقةُ قراءةٍ تُسحَب متى شاء. ومبلغُ التوزيع يُؤخَذ من حركة
 * البنك في الخادم لا من هذا النموذج.
 */
export function DeclarationForm({ categories, candidates, defaults }: {
  categories: readonly { value: string; label: string }[];
  /** حركاتُ البنك لكلّ فئة — مرشّحاتُ التوزيع. */
  candidates: Readonly<Record<string, readonly SpreadCandidate[]>>;
  defaults: { category: string; month: string; kind: Kind };
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>(defaults.kind);
  const [category, setCategory] = useState(defaults.category);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [fromMonth, setFromMonth] = useState(defaults.month);
  const [toMonth, setToMonth] = useState(defaults.month);
  const [txId, setTxId] = useState("");
  /* توزيعٌ بالأيّام: دفعةٌ تغطّي من يومٍ إلى يوم (إيجار ١٠ أغسطس – ٩ فبراير) — كلُّ شهرٍ بأيّامه */
  const [byDays, setByDays] = useState(false);
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsAmount = kind === "OFF_BOOK" || kind === "MEMO";
  const daysOn = kind === "SPREAD" && byDays;
  const options = (candidates[category] ?? []).filter((c) => !c.spread);
  /*
    يومُ الدفعة بدايةُ مدّتها غالباً، ونهايتُها اليومُ السابق لنظيره بعد ستّة أشهر (١٠ أغسطس ← ٩ فبراير) —
    يُملأ اقتراحاً حين تُختار الحركة ويُعدَّل باليد، ولا يُكتب فوق يومٍ كتبه صاحبُه.
  */
  function suggestDays(id: string, force = false) {
    const c = options.find((o) => o.id === id);
    if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(c.day)) return;
    const [y, m, d] = c.day.split("-").map(Number);
    const end = new Date(Date.UTC(y, m - 1 + 6, d - 1)).toISOString().slice(0, 10);
    if (force || fromDay === "") setFromDay(c.day);
    if (force || toDay === "") setToDay(end);
  }
  const categoryLabel = categories.find((c) => c.value === category)?.label ?? "";
  const ready = (daysOn ? fromDay !== "" && toDay !== "" && fromDay <= toDay : fromMonth !== "" && toMonth !== "" && fromMonth <= toMonth)
    && (!needsAmount || amount.trim() !== "") && (kind !== "SPREAD" || txId !== "");

  /* المعطّلُ بسببٍ يُضغط ليقوله (ui-ux.md) — كان «احفظ» معطّلاً صامتاً لا يُعرف ما ينقصه */
  const missing = daysOn && (fromDay === "" || toDay === "") ? "اختر يوم البداية ويوم النهاية."
    : daysOn && fromDay > toDay ? "يوم النهاية قبل يوم البداية."
    : !daysOn && (fromMonth === "" || toMonth === "") ? "اختر شهر البداية وشهر النهاية."
    : !daysOn && fromMonth > toMonth ? "شهر النهاية قبل شهر البداية."
    : needsAmount && amount.trim() === "" ? "اكتب مبلغ الشهر الواحد."
    : kind === "SPREAD" && txId === "" ? "اختر حركة البنك التي تريد توزيعها."
    : null;

  async function save() {
    if (busy) return;
    if (!ready) { setError(missing ?? "أكمل الحقول ثم احفظ."); return; }
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/finance/declaration", {
      action: "create", kind, category,
      label: label.trim() || (kind === "NONE" ? `لا ${categoryLabel}` : categoryLabel),
      amount: needsAmount ? amount.trim() : undefined,
      fromMonth: daysOn ? fromDay.slice(0, 7) : fromMonth, toMonth: daysOn ? toDay.slice(0, 7) : toMonth,
      ...(daysOn ? { fromDay, toDay } : {}),
      bankTransactionId: kind === "SPREAD" ? txId : null,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُفظ ما أضفته" });
    setLabel(""); setAmount(""); setTxId(""); setFromDay(""); setToDay("");
    router.refresh();
  }

  const field = "mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm";
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">ماذا تريد أن تضيف؟</legend>
        {KINDS.map((k) => (
          <label key={k.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${kind === k.value ? "border-accent-line bg-accent-soft/50" : "border-line"}`}>
            <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="mt-1" />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold">{k.label}</span>
              <span className="block text-[11px] leading-relaxed text-muted">{k.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-ink-soft">
          <T s="الفئة{0}" a={[<select key="0" value={category} onChange={(e) => { setCategory(e.target.value); setTxId(""); }} disabled={busy} className={field}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>]} /></label>
        <label className="text-xs font-medium text-ink-soft">
          <T s="وصف قصير {0}{1}" a={[<span key="0" className="font-normal text-muted">(اختياري)</span>, <input key="1" type="text" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} maxLength={120} placeholder={kind === "OFF_BOOK" ? "راتب فلان نقداً" : kind === "MEMO" ? "إهلاك ماكينة القهوة" : categoryLabel} className={field} />]} /></label>

        {kind === "SPREAD" && (
          <label className="text-xs font-medium text-ink-soft sm:col-span-2">
            <T s="حركة البنك التي تريد توزيعها{0}{1}" a={[<select key="0" value={txId} onChange={(e) => { setTxId(e.target.value); if (byDays) suggestDays(e.target.value, true); }} disabled={busy} className={field}>
              <option value="">— اختر —</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.dayLabel} · {c.amountText} ريال · {c.label}</option>)}
            </select>, options.length === 0 && <span key="1" className="mt-1 block text-[11px] text-warn"><T s="لا توجد في الكشف حركة مصنّفة «{0}» لم تُوزَّع بعد. صنّف الحركة أولاً من «حركة البنك»." a={[categoryLabel]} /></span>]} /></label>
        )}
        {needsAmount && (
          <label className="text-xs font-medium text-ink-soft">
            <T s="مبلغ الشهر الواحد (ريال){0}" a={[<input key="0" type="text" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} placeholder="0.00" className={`${field} nums text-end`} />]} /></label>
        )}
        {kind === "SPREAD" && (
          <label className="flex min-h-11 items-center gap-2 text-xs font-medium text-ink-soft sm:col-span-2">
            <input type="checkbox" checked={byDays} onChange={(e) => { setByDays(e.target.checked); if (e.target.checked && txId) suggestDays(txId); }} disabled={busy} />
            وزّعها بالأيام (من يوم إلى يوم)، فيحمل كل شهر أيامه منها
          </label>
        )}
        {daysOn ? (
          <>
            <label className="text-xs font-medium text-ink-soft">
              <T s="من يوم{0}" a={[<input key="0" type="date" dir="ltr" value={fromDay} onChange={(e) => setFromDay(e.target.value)} disabled={busy} className={field} />]} /></label>
            <label className="text-xs font-medium text-ink-soft">
              <T s="إلى يوم (داخلاً){0}" a={[<input key="0" type="date" dir="ltr" value={toDay} onChange={(e) => setToDay(e.target.value)} disabled={busy} className={field} />]} /></label>
          </>
        ) : (
          <>
            <label className="text-xs font-medium text-ink-soft">
              <T s="من شهر{0}" a={[<input key="0" type="month" dir="ltr" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} disabled={busy} className={field} />]} /></label>
            <label className="text-xs font-medium text-ink-soft">
              <T s="إلى شهر{0}" a={[<input key="0" type="month" dir="ltr" value={toMonth} onChange={(e) => setToMonth(e.target.value)} disabled={busy} className={field} />]} /></label>
          </>
        )}
      </div>

      {!daysOn && fromMonth > toMonth && <p role="alert" className="mt-2 text-xs font-bold text-danger">شهر النهاية قبل شهر البداية.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} aria-disabled={!ready || undefined} aria-busy={busy} className={`${buttonClass("primary")} ${ready ? "" : "opacity-60"}`}>احفظ</button>
        <p className="min-w-0 flex-1 basis-56 text-[11px] leading-relaxed text-muted">
          هذه الإضافة لا تنشئ مصروفاً ولا دفعة، ولا تغيّر أي مبلغ مسجّل. تظهر في قائمة الدخل باسمها، وتُسجَّل في سجل التدقيق، ويمكنك سحبها متى شئت.
        </p>
      </div>
    </form>
  );
}
