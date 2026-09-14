"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { postJson } from "@/lib/http-client";

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
export function RecurringExpenses({
  rows,
  inactive = [],
  canEdit = true,
}: {
  rows: ExpenseRow[];
  /** المعطَّل يُعرض ليُعاد — التعطيل بلا باب رجوع نقرةٌ لا تُصلَح */
  inactive?: ExpenseRow[];
  /** من لا يملك `expense:edit` يرى القائمة ولا يرى أزرارها */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<TxCategory>("RENT");
  const [cadence, setCadence] = useState<ExpenseRow["cadence"]>("MONTHLY");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  /* «عطّله» يُسأل عنه قبل أن يقع — نقرةٌ خاطئة كانت تُخرج الإيجار من المتوقَّع بلا رجوع */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const send = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(false);
    try {
      const r = await postJson<{ message?: string }>("/api/expense", payload);
      setMessage(r.ok ? (r.data.message ?? "حُفظ") : r.error);
      setError(!r.ok);
      if (r.ok) {
        setLabel("");
        setAmount("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const monthlyTotal = rows.reduce((s, r) => s + r.monthlyMinor, 0);

  return (
    <div>
      {rows.length > 0 && (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
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
                  {!canEdit ? null : confirmId === r.id ? (
                    <span className="flex items-center gap-1.5">
                      <button
                        onClick={() => { setConfirmId(null); void send({ action: "delete", id: r.id }); }}
                        disabled={busy}
                        className="inline-flex min-h-11 items-center rounded-lg border border-danger/40 bg-danger-bg px-2.5 text-[11px] font-bold text-danger disabled:opacity-40 sm:min-h-0 sm:py-1"
                      >
                        نعم، عطّله
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        className="inline-flex min-h-11 items-center px-2 text-[11px] text-muted sm:min-h-0"
                      >
                        إلغاء
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmId(r.id)}
                      disabled={busy}
                      className="inline-flex min-h-11 items-center px-2 text-[11px] text-muted hover:text-danger disabled:opacity-40 sm:min-h-0"
                    >
                      عطّله
                    </button>
                  )}
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

      {inactive.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-muted">معطَّلة ({inactive.length})</summary>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-dashed border-line">
            {inactive.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-muted">
                <span className="min-w-0 truncate text-xs">{r.label} · {CATEGORY_LABEL[r.category]}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void send({ action: "activate", id: r.id })}
                    disabled={busy}
                    className="inline-flex min-h-11 shrink-0 items-center px-2 text-[11px] text-ink-soft hover:text-ink disabled:opacity-40 sm:min-h-0"
                  >
                    فعِّله
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-raised shadow-raised p-3">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="اسم المصروف — إيجار المحل"
          aria-label="اسم المصروف"
          dir="auto"
          className="min-w-[10rem] flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-ink"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="المبلغ"
          aria-label="المبلغ بالريال"
          inputMode="decimal"
          dir="ltr"
          className="nums w-24 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-ink"
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value as ExpenseRow["cadence"])}
          aria-label="الدورة"
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
        >
          {(Object.keys(CADENCE_LABEL) as ExpenseRow["cadence"][]).map((c) => (
            <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as TxCategory)}
          aria-label="الباب"
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
      )}

      {message && (
        <p className={`mt-2 text-[11px] font-bold ${error ? "text-danger" : "text-ok"}`}>
          {error ? "" : "✓ "}{message}
        </p>
      )}
    </div>
  );
}
