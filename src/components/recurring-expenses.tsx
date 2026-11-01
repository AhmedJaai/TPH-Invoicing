"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Repeat, RotateCcw } from "lucide-react";
import { Money } from "./money";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { postJson } from "@/lib/http-client";
import { type Cadence } from "@/lib/cadence";
import { formatRiyals } from "@/lib/money";
import { formatDay } from "@/lib/riyadh-time";
import { buttonClass } from "./ui-tokens";
import { ReadySubmit, toast } from "./ui-client";
import { T } from "@/components/i18n/t";

export interface ExpenseRow {
  id: string;
  label: string;
  category: TxCategory;
  amountMinor: number;
  cadence: Cadence;
  monthlyMinor: number;
  /** أوّلُ استحقاق — منه يومُ الشهر في «النقد القادم»، وإلّا «يومٌ غير محدَّد». */
  startsOn: string | null;
}

const CATEGORIES: TxCategory[] = ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "ZAKAT", "OTHER"];
const CADENCE_LABEL: Record<Cadence, string> = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  SEMIANNUAL: "نصف سنوي",
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
/** دفعةٌ مقدّمة معروفة من الكشف يُقترح تسجيلُها متكرّرةً — `RecurringSuggestion` بلا اعتمادٍ على الخادم. */
export interface RecurringSuggestionRow {
  category: TxCategory;
  label: string;
  amountMinor: number;
  cadence: Cadence;
  startsOn: string;
  nextDue: string;
}

export function RecurringExpenses({
  rows,
  inactive = [],
  canEdit = true,
  suggestions = [],
}: {
  rows: ExpenseRow[];
  inactive?: ExpenseRow[];
  canEdit?: boolean;
  suggestions?: RecurringSuggestionRow[];
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<TxCategory>("RENT");
  const [cadence, setCadence] = useState<Cadence>("MONTHLY");
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
      toast({ tone: "ok", title: `أُضيف «${label.trim()}»`, body: startsOn ? "سيظهر في «النقد القادم» في يوم استحقاقه." : "سيظهر في «النقد القادم» بلا يوم محدد." });
      setLabel("");
      setAmount("");
      setStartsOn("");
    }
  }

  /* ضغطةُ صاحب الصلاحية هي الإقرار: يُسجَّل بما في الكشف، والخادمُ يتحقّق من التاريخ والدورة كأيّ إضافة */
  async function adopt(s: RecurringSuggestionRow) {
    const ok = await send({ action: "create", label: s.label, amount: formatRiyals(s.amountMinor), category: s.category, cadence: s.cadence, startsOn: s.startsOn });
    if (ok) toast({ tone: "ok", title: `سُجّل «${s.label}» كل ستة أشهر`, body: `الاستحقاق التالي ${formatDay(s.nextDue)}، ويظهر في «النقد القادم» وعند المستشار.` });
  }

  async function deactivate(r: ExpenseRow) {
    const ok = await send({ action: "delete", id: r.id });
    if (ok) {
      toast({
        tone: "ok",
        title: `عُطّل «${r.label}»`,
        body: "خرج من المتوقع ومن «النقد القادم»، ولم يُحذف.",
        undo: { run: () => send({ action: "activate", id: r.id }) },
      });
    }
  }

  const monthlyTotal = rows.reduce((s, r) => s + r.monthlyMinor, 0);

  return (
    <div className="space-y-3">
      {canEdit && suggestions.map((s) => (
        <div key={s.category} className="rounded-xl border border-accent-line bg-accent-soft p-4">
          <p className="text-[13px] font-bold leading-relaxed">
            <T s="{0}: آخر دفعة {1} في {2}. هل تُدفع كل ستة أشهر؟" a={[s.label, <Money key="1" minor={s.amountMinor} />, <bdi key="2">{formatDay(s.startsOn)}</bdi>]} />
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            <T s="إن سجّلته فالاستحقاق التالي {0}: يظهر في «النقد القادم» قبل موعده، وعند المستشار، ويُسأل عنه في شهره فقط." a={[<bdi key="0">{formatDay(s.nextDue)}</bdi>]} />
          </p>
          <button type="button" onClick={() => void adopt(s)} disabled={busy} aria-busy={busy} className={`${buttonClass("primary", "sm")} mt-3`}>
            <T s="{0}سجّله كل ستة أشهر" a={[<Plus key="0" className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />]} />
          </button>
        </div>
      ))}
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
                    {r.startsOn ? ` · من ${r.startsOn}` : " · بلا يوم محدد"}
                    {r.cadence !== "MONTHLY" && <> <T s=" · {0} لكل دورة" a={[<Money key="0" minor={r.amountMinor} />]} /></>}
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
                    عطّل
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="flex items-center justify-between gap-3 border-t border-line bg-sunken/60 px-4 py-2.5 text-xs font-bold">
            <span>المتوقع شهرياً</span>
            <Money minor={monthlyTotal} />
          </p>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-muted">
          لا مصروفات متكررة مسجّلة بعد. سجّل الإيجار والاشتراكات هنا لتظهر في «النقد القادم»، ويُقارن المتوقع بالفعلي. والرواتب يحملها مسيّر الرواتب.
        </p>
      )}

      {inactive.length > 0 && (
        <details className="rounded-xl border border-dashed border-line px-4 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted sm:min-h-8"><T s="معطّلة ({0})" a={[<span key="0" className="nums">{inactive.length}</span>]} /></summary>
          <ul className="divide-y divide-line-soft pb-1">
            {inactive.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-muted">
                <span className="min-w-0 truncate text-xs">{r.label} · {CATEGORY_LABEL[r.category]}</span>
                {canEdit && (
                  <button type="button" onClick={() => void send({ action: "activate", id: r.id })} disabled={busy} className={buttonClass("quiet", "sm")}>
                    <T s="{0} فعّل" a={[<RotateCcw key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></button>
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
          <p className="mb-3 text-[13px] font-bold">أضف مصروفاً متكرراً</p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
              <select value={cadence} onChange={(e) => setCadence(e.target.value as Cadence)} className={`${field} mt-1.5`}>
                {(Object.keys(CADENCE_LABEL) as Cadence[]).map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs">
              <span className="font-bold text-ink-soft">التصنيف</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as TxCategory)} className={`${field} mt-1.5`}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs sm:col-span-2 lg:col-span-2">
              <span className="font-bold text-ink-soft">
                {cadence === "MONTHLY"
                  ? <T s="أول استحقاق {0}" a={[<span key="0" className="font-normal text-muted">(اختياري، ومنه يُعرف يوم الشهر)</span>]} />
                  : <T s="تاريخ استحقاق {0}" a={[<span key="0" className="font-normal text-muted">(مطلوب: منه يُعرف الشهر الذي يقع فيه، ثم يتكرر كل دورة)</span>]} />}
              </span>
              <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} dir="ltr" className={`${field} mt-1.5`} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ReadySubmit ready={label.trim().length >= 2 && amount.trim() !== "" && (cadence === "MONTHLY" || startsOn !== "")} busy={busy} size="sm" missing={label.trim().length < 2 ? "اكتب اسم المصروف (حرفان على الأقل)." : amount.trim() === "" ? "اكتب المبلغ بالريال." : "اكتب تاريخ الاستحقاق: بدونه لا يُعرف في أي شهر يقع."}>
              <T s="{0}أضف" a={[<Plus key="0" className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />]} /></ReadySubmit>
            {error && <p role="alert" className="text-xs font-bold text-danger">{error}</p>}
          </div>
        </form>
      )}
    </div>
  );
}
