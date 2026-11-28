import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Search, SlidersHorizontal, X } from "lucide-react";
import { Money } from "./money";
import { buttonClass, fieldClass } from "./ui-tokens";
import { CATEGORY_LABEL } from "@/lib/bank/rules";
import {
  CATEGORY_OPTIONS, LEDGER_STATES, LEDGER_STATE_LABEL, hasLedgerFilters, minorToInput, type LedgerFilters,
} from "@/lib/bank/ledger-filters";
import { formatRiyalsDisplay } from "@/lib/money";
import { countNoun, TRANSACTION } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";

/**
 * شريطُ البحث في سجلّ البنك — نصٌّ أو مبلغ، ومعه المدى بالتاريخ والمبلغ
 * والتصنيفُ والحال. نموذجٌ بـ`GET`: كلُّ شيءٍ في العنوان، فيُحفَظ الرابطُ
 * ويُرسَل، ويعمل بلا JavaScript. وما طُبّق يظهر رقاقاتٍ تُزال كلٌّ بضغطة.
 */
export function LedgerFilterBar({
  q, filters, hidden, clearHref, chipHref,
}: {
  q: string;
  filters: LedgerFilters;
  /** ما يُحمَل مع النموذج كما هو: اللسانُ والشهر. */
  hidden: Record<string, string>;
  /** الرابطُ بلا بحثٍ ولا مرشِّح. */
  clearHref: string;
  /** الرابطُ بعد إزالة مفتاحٍ واحد (`q` · `from` …). */
  chipHref: (drop: readonly string[]) => string;
}) {
  const active = hasLedgerFilters(filters);
  const chips: { key: string; label: string; drop: readonly string[] }[] = [];
  if (q) chips.push({ key: "q", label: `«${q}»`, drop: ["q"] });
  if (filters.fromDay || filters.toDay) {
    chips.push({
      key: "day",
      label: filters.fromDay && filters.toDay
        ? `من ${formatDay(filters.fromDay)} إلى ${formatDay(filters.toDay)}`
        : filters.fromDay ? `من ${formatDay(filters.fromDay)}` : `حتى ${formatDay(filters.toDay)}`,
      drop: ["from", "to"],
    });
  }
  if (filters.minMinor !== null || filters.maxMinor !== null) {
    chips.push({
      key: "amount",
      label: filters.minMinor !== null && filters.maxMinor !== null
        ? `بين ${formatRiyalsDisplay(filters.minMinor)} و${formatRiyalsDisplay(filters.maxMinor)}`
        : filters.minMinor !== null ? `من ${formatRiyalsDisplay(filters.minMinor)} فأكثر` : `حتى ${formatRiyalsDisplay(filters.maxMinor ?? 0)}`,
      drop: ["min", "max"],
    });
  }
  if (filters.category) chips.push({ key: "cat", label: CATEGORY_LABEL[filters.category], drop: ["cat"] });
  if (filters.state) chips.push({ key: "state", label: LEDGER_STATE_LABEL[filters.state], drop: ["state"] });

  return (
    <div className="mb-3 space-y-2">
      <form action="/bank#transactions" role="search" aria-label="ابحث في سجل الحركات">
        {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-0 flex-1 basis-64 items-center sm:max-w-md">
            <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="مبلغ أو اسم أو نص"
              aria-label="ابحث في كل الحركات بالمبلغ أو الاسم أو نص البنك"
              dir="auto"
              className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-9 pe-3 text-sm sm:min-h-10"
            />
          </label>
          <button type="submit" className={buttonClass("primary", "sm")}>ابحث</button>
        </div>

        {/* المدى مطويٌّ حتى يُطلب — ومفتوحٌ ما دام فيه مرشِّحٌ مطبَّق، فلا يُنسى ما يضيّق النتائج */}
        <details open={active} className="group mt-2 rounded-xl border border-line bg-raised open:shadow-raised">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-xs font-bold text-ink-soft hover:text-ink sm:min-h-9 [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden />
            ضيّق بالتاريخ أو المبلغ أو التصنيف أو الحالة
          </summary>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 border-t border-line px-3 py-3 sm:grid-cols-2 lg:grid-cols-4">
            <fieldset className="min-w-0">
              <legend className="mb-1 text-[11px] font-bold text-muted">التاريخ</legend>
              <div className="flex items-center gap-1.5">
                <input type="date" name="from" defaultValue={filters.fromDay ?? ""} aria-label="من يوم" className={fieldClass("sm")} />
                <span className="text-[11px] text-muted">إلى</span>
                <input type="date" name="to" defaultValue={filters.toDay ?? ""} aria-label="إلى يوم" className={fieldClass("sm")} />
              </div>
            </fieldset>
            <fieldset className="min-w-0">
              <legend className="mb-1 text-[11px] font-bold text-muted">المبلغ بالريال</legend>
              <div className="flex items-center gap-1.5">
                <input name="min" inputMode="decimal" dir="ltr" placeholder="من" defaultValue={filters.minMinor !== null ? minorToInput(filters.minMinor) : ""} aria-label="أقل مبلغ بالريال" className={fieldClass("sm")} />
                <span className="text-[11px] text-muted">إلى</span>
                <input name="max" inputMode="decimal" dir="ltr" placeholder="إلى" defaultValue={filters.maxMinor !== null ? minorToInput(filters.maxMinor) : ""} aria-label="أكبر مبلغ بالريال" className={fieldClass("sm")} />
              </div>
            </fieldset>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-muted">التصنيف</span>
              <select name="cat" defaultValue={filters.category ?? ""} className={fieldClass("sm")}>
                <option value="">كل التصنيفات</option>
                {CATEGORY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            <label className="min-w-0">
              <span className="mb-1 block text-[11px] font-bold text-muted">الحالة</span>
              <select name="state" defaultValue={filters.state ?? ""} className={fieldClass("sm")}>
                <option value="">كل الحالات</option>
                {LEDGER_STATES.map((s) => <option key={s} value={s}>{LEDGER_STATE_LABEL[s]}</option>)}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
              <button type="submit" className={buttonClass("secondary", "sm")}>طبّق</button>
              <span className="text-[11px] text-muted">يُحفظ ما تختاره في رابط الصفحة، فيمكنك حفظه أو إرساله.</span>
            </div>
          </div>
        </details>
      </form>

      {chips.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="ما يضيّق النتائج الآن">
          {chips.map((c) => (
            <li key={c.key}>
              <Link
                href={chipHref(c.drop)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft/60 ps-3 pe-2 text-xs font-bold text-accent hover:bg-accent-soft sm:min-h-8"
                aria-label={`أزِل: ${c.label}`}
              >
                <bdi>{c.label}</bdi>
                <X className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
              </Link>
            </li>
          ))}
          {chips.length > 1 && (
            <li>
              <Link href={clearHref} className="inline-flex min-h-11 items-center px-2 text-xs font-bold text-ink-soft hover:text-accent hover:underline sm:min-h-8">
                امسح الكل
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * جوابُ البحث: كم حركةً طابقت، وكم خرج فيها وكم دخل — على ما طابق كلِّه
 * لا على المرسوم وحده. والمرسومُ إن قُصّ يُقال.
 */
export function LedgerResultSummary({
  total, shown, sums, scope,
}: {
  total: number;
  shown: number;
  sums: { outMinor: number; inMinor: number };
  /** «في المبالغ الخارجة · كل الأشهر» ونحوه. */
  scope: React.ReactNode;
}) {
  if (total === 0) return null;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{countNoun(total, TRANSACTION)} تطابق</p>
        <p className="mt-0.5 text-[11px] text-muted">{scope}</p>
      </div>
      {sums.outMinor > 0 && (
        <p className="flex items-center gap-1.5 text-sm">
          <ArrowUpRight className="h-4 w-4 text-ink-soft" strokeWidth={2.25} aria-hidden />
          <span className="text-[11px] text-muted">خرج</span>
          <span className="font-bold"><Money minor={sums.outMinor} /></span>
        </p>
      )}
      {sums.inMinor > 0 && (
        <p className="flex items-center gap-1.5 text-sm">
          <ArrowDownLeft className="h-4 w-4 text-ok" strokeWidth={2.25} aria-hidden />
          <span className="text-[11px] text-muted">دخل</span>
          <span className="font-bold text-ok"><Money minor={sums.inMinor} /></span>
        </p>
      )}
      {total > shown && (
        <p className="basis-full text-[11px] text-ink-soft">
          المجموع على كل ما يطابق. المعروض أدناه أحدث {countNoun(shown, TRANSACTION)}، فضيّق التاريخ لترى الباقي.
        </p>
      )}
    </div>
  );
}
