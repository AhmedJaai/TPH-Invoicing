"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { todayInRiyadh } from "@/lib/riyadh-time";

const CATEGORIES: TxCategory[] = ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "ZAKAT", "OTHER"];

/**
 * قيدُ مصروفٍ دُفع خارج البنك.
 *
 * الصفحة تقول عن المصروف المتوقَّع الذي لم يظهر في الكشف «قد يكون دُفع
 * نقداً» — ولم يكن هناك موضعٌ لقيده. فالمال الذي خرج نقداً بقي خارج
 * المصروفات، ويظهر الشهر أخفّ ممّا كان.
 */
export function ManualExpense() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayInRiyadh());
  const [category, setCategory] = useState<TxCategory>("OTHER");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center rounded-lg border border-line px-3 text-xs sm:min-h-8"
      >
        + قيّد مصروفاً دُفع نقداً
      </button>
    );
  }

  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const r = await postJson<{ message?: string }>("/api/expense-actual", {
        action: "record", label, amount, occurredOn, category,
      });
      setResult({ ok: r.ok, text: r.ok ? (r.data.message ?? "قُيّد") : r.error });
      if (r.ok) {
        setLabel("");
        setAmount("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-ink";

  return (
    <div className="rounded-2xl border border-line bg-raised p-3 shadow-raised">
      <p className="mb-2 text-xs font-bold">مصروفٌ دُفع خارج البنك</p>
      <div className="flex flex-wrap items-center gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="البند — صيانة المكيّف"
          aria-label="البند" dir="auto" className={`min-w-[10rem] flex-1 ${field}`} />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="المبلغ"
          aria-label="المبلغ بالريال" inputMode="decimal" dir="ltr" className={`nums w-24 ${field}`} />
        <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)}
          aria-label="تاريخ الدفع" dir="ltr" className={`nums ${field}`} />
        <select value={category} onChange={(e) => setCategory(e.target.value as TxCategory)}
          aria-label="الباب" className={field}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <button type="button" onClick={() => void save()}
          disabled={busy || label.trim().length < 2 || !amount.trim() || !occurredOn}
          className="inline-flex min-h-11 items-center rounded-lg bg-inverse-surface px-3 text-[11px] font-bold text-inverse-ink disabled:opacity-30 sm:min-h-8">
          {busy ? "يقيّد…" : "قيّده"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setResult(null); }}
          className="inline-flex min-h-11 items-center px-2 text-[11px] text-muted sm:min-h-8">
          إلغاء
        </button>
      </div>
      {result && (
        <p role="status" className={`mt-2 text-[11px] font-bold ${result.ok ? "text-ok" : "text-danger"}`}>
          {result.ok ? "✓ " : ""}{result.text}
        </p>
      )}
    </div>
  );
}
