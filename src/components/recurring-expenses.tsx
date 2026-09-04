"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";

export interface ExpenseRow {
  id: string;
  label: string;
  category: TxCategory;
  amountMinor: number;
  cadence: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  monthlyMinor: number;
}

const CATEGORIES: TxCategory[] = ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "ZAKAT", "OTHER"];
const CADENCE_LABEL: Record<ExpenseRow["cadence"], string> = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  ANNUAL: "سنوي",
};

/**
 * المصروفات المتكرّرة.
 * الإيجار السنوي يُسجَّل مرّة، ويُعرض بحصّته الشهرية — فلا يبدو شهرٌ ضخماً
 * وأحد عشر خفيفة.
 */
export function RecurringExpenses({ rows }: { rows: ExpenseRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<TxCategory>("RENT");
  const [cadence, setCadence] = useState<ExpenseRow["cadence"]>("MONTHLY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/expense", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      setMessage(json.message ?? json.error);
      setError(!res.ok);
      if (res.ok) {
        setLabel("");
        setAmount("");
        router.refresh();
      }
    } catch (e) {
      setMessage((e as Error).message);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const monthlyTotal = rows.reduce((s, r) => s + r.monthlyMinor, 0);

  return (
    <div>
      {rows.length > 0 && (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{r.label}</span>
                  <span className="block text-[11px] text-muted">
                    {CATEGORY_LABEL[r.category]} · {CADENCE_LABEL[r.cadence]}
                    {r.cadence !== "MONTHLY" && ` · ${formatRiyalsDisplay(r.amountMinor)} لكل دورة`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="nums text-sm font-bold" dir="ltr">
                    {formatRiyalsDisplay(r.monthlyMinor)}
                  </span>
                  <button
                    onClick={() => void send({ action: "delete", id: r.id })}
                    disabled={busy}
                    className="text-[11px] text-muted hover:text-danger disabled:opacity-40"
                  >
                    عطّله
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs font-bold">
            المتوقَّع شهرياً:{" "}
            <span className="nums" dir="ltr">{formatRiyalsDisplay(monthlyTotal)}</span> ريال
          </p>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised p-3">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="اسم المصروف — إيجار المحل"
          dir="auto"
          className="min-w-[10rem] flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-ink"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="المبلغ"
          dir="ltr"
          className="nums w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-ink"
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as ExpenseRow["cadence"])}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
        >
          {(Object.keys(CADENCE_LABEL) as ExpenseRow["cadence"][]).map((c) => (
            <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as TxCategory)}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
          ))}
        </select>
        <button
          onClick={() => void send({ action: "create", label, amount, category, cadence })}
          disabled={busy || label.trim().length < 2 || !amount.trim()}
          className="rounded-lg bg-inverse-surface px-3 py-1.5 text-[11px] font-bold text-inverse-ink disabled:opacity-30"
        >
          {busy ? "…" : "أضِف"}
        </button>
      </div>

      {message && (
        <p className={`mt-2 text-[11px] font-bold ${error ? "text-danger" : "text-ok"}`}>
          {error ? "" : "✓ "}{message}
        </p>
      )}
    </div>
  );
}
