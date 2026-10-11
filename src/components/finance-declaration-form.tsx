"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

export interface SpreadCandidate { id: string; day: string; dayLabel: string; amountText: string; label: string; spread: boolean }

const KINDS = [
  { value: "OFF_BOOK", label: "مصروفٌ خارج الكشف يتكرّر كلَّ شهر", hint: "راتبٌ يُدفَع نقداً، إيجارٌ من حسابٍ شخصيّ. اكتب مبلغَ الشهر الواحد." },
  { value: "SPREAD", label: "دفعةٌ في الكشف تغطّي أشهراً", hint: "إيجارٌ دُفع مرّةً لستّة أشهر: يُوزَّع بالتساوي على أشهره." },
  { value: "NONE", label: "لا يوجد في هذه الأشهر", hint: "لم يكن على المقهى هذا المصروفُ فيها — فلا يُعدّ ناقصاً." },
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = (candidates[category] ?? []).filter((c) => !c.spread);
  const categoryLabel = categories.find((c) => c.value === category)?.label ?? "";
  const ready = fromMonth !== "" && toMonth !== "" && fromMonth <= toMonth
    && (kind !== "OFF_BOOK" || amount.trim() !== "") && (kind !== "SPREAD" || txId !== "");

  async function save() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/finance/declaration", {
      action: "create", kind, category,
      label: label.trim() || (kind === "NONE" ? `لا ${categoryLabel}` : categoryLabel),
      amount: kind === "OFF_BOOK" ? amount.trim() : undefined,
      fromMonth, toMonth,
      bankTransactionId: kind === "SPREAD" ? txId : null,
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُفظ الإقرار" });
    setLabel(""); setAmount(""); setTxId("");
    router.refresh();
  }

  const field = "mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm";
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">ما الذي تقوله؟</legend>
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
          الفئة
          <select value={category} onChange={(e) => { setCategory(e.target.value); setTxId(""); }} disabled={busy} className={field}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-ink-soft">
          وصفٌ قصير <span className="font-normal text-muted">(اختياريّ)</span>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} disabled={busy} maxLength={120} placeholder={kind === "OFF_BOOK" ? "راتبُ فلان نقداً" : categoryLabel} className={field} />
        </label>

        {kind === "SPREAD" && (
          <label className="text-xs font-medium text-ink-soft sm:col-span-2">
            حركةُ البنك التي تُوزَّع
            <select value={txId} onChange={(e) => setTxId(e.target.value)} disabled={busy} className={field}>
              <option value="">— اختر —</option>
              {options.map((c) => <option key={c.id} value={c.id}>{c.dayLabel} · {c.amountText} ريال · {c.label}</option>)}
            </select>
            {options.length === 0 && <span className="mt-1 block text-[11px] text-warn">لا حركةَ في الكشف مصنَّفةً «{categoryLabel}» لم تُوزَّع. صنّف الحركةَ في «حركة البنك» أوّلاً.</span>}
          </label>
        )}
        {kind === "OFF_BOOK" && (
          <label className="text-xs font-medium text-ink-soft">
            مبلغُ الشهر الواحد (ريال)
            <input type="text" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} placeholder="0.00" className={`${field} nums text-end`} />
          </label>
        )}
        <label className="text-xs font-medium text-ink-soft">
          من شهر
          <input type="month" dir="ltr" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} disabled={busy} className={field} />
        </label>
        <label className="text-xs font-medium text-ink-soft">
          إلى شهر
          <input type="month" dir="ltr" value={toMonth} onChange={(e) => setToMonth(e.target.value)} disabled={busy} className={field} />
        </label>
      </div>

      {fromMonth > toMonth && <p role="alert" className="mt-2 text-xs font-bold text-danger">آخرُ شهرٍ قبل أوّله.</p>}
      {error && <p role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !ready} aria-busy={busy} className={buttonClass("primary")}>احفظ الإقرار</button>
        <p className="min-w-0 flex-1 basis-56 text-[11px] leading-relaxed text-muted">
          لا يُنشأ مصروفٌ ولا دفعة ولا يُمسّ مالٌ مقيَّد. يدخل قائمةَ الدخل باسمه، ويُكتب في سجلّ التدقيق، ويُسحَب متى شئت.
        </p>
      </div>
    </form>
  );
}
