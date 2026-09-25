"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Repeat, RotateCcw } from "lucide-react";
import { Money } from "./money";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

export interface ExpenseRow {
  id: string;
  label: string;
  category: TxCategory;
  amountMinor: number;
  cadence: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  monthlyMinor: number;
  /** أوّلُ استحقاق — منه يومُ الشهر في «النقد القادم»، وإلّا «يومٌ غير محدَّد». */
  startsOn: string | null;
}

const CATEGORIES: TxCategory[] = ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "ZAKAT", "OTHER"];
const CADENCE_LABEL: Record<ExpenseRow["cadence"], string> = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  ANNUAL: "سنوي",
};

const field = "min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-10";

/**
 * المصروفات المتكرّرة — الإيجارُ والرواتبُ والاشتراكات.
 *
 * يُسجَّل السنويّ مرّةً ويُعرض بحصّته الشهريّة، فلا يبدو شهرٌ ضخماً وأحدَ عشرَ
 * خفيفة. وأوّلُ استحقاقٍ اختياريّ: به يقع البندُ في «النقد القادم» في يومه.
 * والتعطيلُ لا حذف، ويُتراجَع عنه من الإشعار.
 */
export function RecurringExpenses({
  rows,
  inactive = [],
  canEdit = true,
}: {
  rows: ExpenseRow[];
  inactive?: ExpenseRow[];
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<TxCategory>("RENT");
  const [cadence, setCadence] = useState<ExpenseRow["cadence"]>("MONTHLY");
  const [startsOn, setStartsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ message?: string }>("/api/expense", payload);
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const ok = await send({ action: "create", label, amount, category, cadence, startsOn: startsOn || undefined });
    if (ok) {
      toast({ tone: "ok", title: `أُضيف «${label.trim()}»`, body: startsOn ? "ويظهر في النقد القادم في يومه." : "ويظهر في النقد القادم بلا يومٍ محدَّد." });
      setLabel("");
      setAmount("");
      setStartsOn("");
    }
  }

  async function deactivate(r: ExpenseRow) {
    const ok = await send({ action: "delete", id: r.id });
    if (ok) {
      toast({
        tone: "ok",
        title: `عُطّل «${r.label}»`,
        body: "خرج من المتوقَّع ومن النقد القادم — ولم يُحذف.",
        undo: { run: () => send({ action: "activate", id: r.id }) },
      });
    }
  }

  const monthlyTotal = rows.reduce((s, r) => s + r.monthlyMinor, 0);

  return (
    <div className="space-y-3">
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                  <Repeat className="h-4 w-4" strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{r.label}</span>
                  <span className="block text-[11px] text-muted">
                    {CATEGORY_LABEL[r.category]} · {CADENCE_LABEL[r.cadence]}
                    {r.startsOn ? ` · من ${r.startsOn}` : " · يومٌ غير محدَّد"}
                    {r.cadence !== "MONTHLY" && <> · <Money minor={r.amountMinor} /> لكلّ دورة</>}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block text-sm font-bold"><Money minor={r.monthlyMinor} /></span>
                  <span className="block text-[11px] text-muted">شهرياً</span>
                </span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => void deactivate(r)}
                    disabled={busy}
                    className={buttonClass("quiet", "sm")}
                  >
                    عطّله
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="flex items-center justify-between gap-3 border-t border-line bg-sunken/60 px-4 py-2.5 text-xs font-bold">
            <span>المتوقَّع شهرياً</span>
            <Money minor={monthlyTotal} />
          </p>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-muted">
          لا مصروفَ متكرّراً مسجّلاً بعد. سجّل الإيجار والرواتب هنا فيظهر خروجُهما في «النقد القادم» ويُقابَل المتوقَّعُ بالفعليّ.
        </p>
      )}

      {inactive.length > 0 && (
        <details className="rounded-xl border border-dashed border-line px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted sm:min-h-8">معطَّلة (<span className="nums">{inactive.length}</span>)</summary>
          <ul className="divide-y divide-line-soft pb-1">
            {inactive.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-muted">
                <span className="min-w-0 truncate text-xs">{r.label} · {CATEGORY_LABEL[r.category]}</span>
                {canEdit && (
                  <button type="button" onClick={() => void send({ action: "activate", id: r.id })} disabled={busy} className={buttonClass("quiet", "sm")}>
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /> فعِّله
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canEdit && (
        <form
          className="rounded-xl border border-line bg-raised p-4 shadow-raised"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
        >
          <p className="mb-3 text-[13px] font-bold">أضِف مصروفاً متكرّراً</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="block text-xs lg:col-span-2">
              <span className="font-bold text-ink-soft">الاسم</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="إيجار المحل" dir="auto" className={`${field} mt-1.5`} />
            </label>
            <label className="block text-xs">
              <span className="font-bold text-ink-soft">المبلغ بالريال</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" dir="ltr" className={`nums ${field} mt-1.5`} />
            </label>
            <label className="block text-xs">
              <span className="font-bold text-ink-soft">الدورة</span>
              <select value={cadence} onChange={(e) => setCadence(e.target.value as ExpenseRow["cadence"])} className={`${field} mt-1.5`}>
                {(Object.keys(CADENCE_LABEL) as ExpenseRow["cadence"][]).map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="font-bold text-ink-soft">الباب</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as TxCategory)} className={`${field} mt-1.5`}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs sm:col-span-2 lg:col-span-2">
              <span className="font-bold text-ink-soft">أوّلُ استحقاق <span className="font-normal text-muted">(اختياريّ — منه يومُ الشهر)</span></span>
              <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} dir="ltr" className={`${field} mt-1.5`} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || label.trim().length < 2 || !amount.trim()} className={buttonClass("primary", "sm")}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              {busy ? "يحفظ…" : "أضِف"}
            </button>
            {error && <p role="alert" className="text-xs font-bold text-danger">{error}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
