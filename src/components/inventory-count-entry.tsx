"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { Meter, buttonClass } from "./ui";
import { toast } from "./ui-client";
import { Money } from "./money";
import { Toolbar } from "./inventory-toolbar";
import { DIRECTION, type Direction } from "./inventory-ui";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { decimalToMilli } from "@/lib/inventory/units";

/**
 * شاشةُ العدّ الأسبوعيّ — خانةٌ واحدة لكلّ صنف.
 *
 * ── ما تُحسّنه ──
 *
 * صاحبُ المقهى يقف عند الرفّ ومعه ميزان، ويكتب رقماً ثمّ ينتقل. فكلُّ
 * ما عدا **خانة الفعليّ** محسوبٌ ومعروض، والتنقّل بـEnter لا بالفأرة،
 * وارتفاعُ اللمس ٤٤ بكسلاً لأنّه يضغط بإبهامه.
 *
 * ── والحفظُ لا يقع بالمصادفة ──
 *
 * يُحفَظ **ما تغيّر وحده** عند الضغط. والمسوّدةُ تبقى مسوّدة: يخرج
 * ويعود فيجد ما أدخله. والإقفالُ فعلٌ آخر في مكانٍ آخر.
 *
 * ── ويُعَدّ بالوحدة التي يُوزَن بها ──
 *
 * وحدةُ الصنف في الكتالوج هي وحدةُ **صرفه** — البنُّ بالجرام لأنّ
 * الوصفة تقول «٢٠ جراماً». وصاحبُ المقهى يزن الكيسَ فيقرأ «٥٫٢ كجم»،
 * فلو لزمته الوحدةُ الصغرى لكتب «٥٢٠٠» وأخطأ في صفرٍ لا يُرى أثرُه
 * إلّا في فرقٍ بعشرة أضعاف.
 *
 * فتُعرَض له وحدتا عائلته، ويختار. **والتحويلُ في الخادم** لا هنا:
 * يصل الرقمُ ووحدتُه، ويُحوَّل هناك — فلا يُصدَّق المتصفّح في رقمٍ
 * يُبنى عليه قرار.
 *
 * ── ولا يُحسَب فرقٌ في المتصفّح يُعتمَد عليه ──
 *
 * الفرقُ المعروض أثناء الكتابة **مؤشِّرٌ فوريّ** لا رقمٌ يُحفَظ. والرقمُ
 * الذي يدخل التقرير يحسبه الخادم بعد الحفظ ويُعيده. والدرسُ من
 * `confirm.ts`: لا يُصدَّق المتصفّح في رقمٍ يُبنى عليه قرار.
 */

export interface CountRow {
  productId: string;
  productName: string;
  category: string;
  categoryLabel: string;
  unitLabel: string;
  /** وحدةُ الصنف كما تُخزَّن — يُرسَل ما يختاره ويُحوَّل في الخادم. */
  baseUnit: string;
  /** وحدتا عائلته بأسمائهما — واحدةٌ فقط لما لا أكبرَ له. */
  unitChoices: { value: string; label: string }[];
  /** المتوقَّع بوحدة الصنف — نصّاً كما يُعرَض، أو `null` «غير معروف». */
  expected: string | null;
  /** ما أُدخل سابقاً بوحدة الصنف، نصّاً. */
  actual: string;
  varianceText: string | null;
  varianceBpText: string | null;
  varianceCostMinor: number | null;
  /** أسبابٌ تُقرأ — لماذا جُهل ما جُهل. */
  flags: string[];
  negative: boolean;
  /** جهةُ الفرق المحسوب في الخادم — و`null` «لم يُحسَب». */
  direction: Direction | null;
}

export function InventoryCountEntry({
  countId,
  rows,
  categories,
  canEdit,
  locked,
  onDirtyChange,
}: {
  countId: string;
  rows: CountRow[];
  categories: { key: string; label: string }[];
  canEdit: boolean;
  locked: boolean;
  /** كم صنفاً كُتب ولم يُحفَظ — يُنبَّه عليه قبل المغادرة. */
  onDirtyChange?: (n: number) => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.actual])),
  );
  /* الوحدةُ المختارة لكلّ صنف — وأوّلُها وحدتُه في الكتالوج */
  const [units, setUnits] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.baseUnit])),
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  /*
    ما حفظه الخادم هو الأصل. والصفوفُ مصفوفةٌ جديدة في كلّ رسم (يرشّحها
    الأب)، فيُقاس التغيّرُ ببصمةٍ نصّيّة لا بهويّة المصفوفة — وإلّا عُدّ
    كلُّ رسمٍ «وصولَ بياناتٍ جديدة».
  */
  const sig = rows.map((r) => `${r.productId}:${r.actual}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.productId, r.actual])), [sig]);
  const [syncedSig, setSyncedSig] = useState(sig);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [syncedInitial, setSyncedInitial] = useState(initial);
  if (syncedSig !== sig) {
    /* بعد الحفظ: ما لم يمسّه صاحبُه منذ آخر وصول يأخذ قيمةَ الخادم الجديدة */
    setSyncedSig(sig);
    setSyncedInitial(initial);
    setValues((v) => {
      const next = { ...v };
      for (const r of rows) {
        const now = v[r.productId] ?? "";
        /* لم يمسّه منذ الوصول السابق، أو هو ما أُرسل للتوّ فصار الخادمُ يكتبه بصيغته («5.20» ← «5.2») */
        if (now === (syncedInitial[r.productId] ?? "") || now === sent[r.productId]) next[r.productId] = r.actual;
      }
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (onlyUncounted && (initial[r.productId] ?? "").trim() !== "") return false;
      if (q && !r.productName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, category, onlyUncounted, initial]);

  const dirty = rows.filter((r) => (values[r.productId] ?? "") !== (initial[r.productId] ?? ""));
  const counted = rows.filter((r) => (values[r.productId] ?? "").trim() !== "").length;
  const invalid = dirty.filter((r) => !validQuantity(values[r.productId] ?? ""));

  useEffect(() => { onDirtyChange?.(dirty.length); }, [dirty.length, onDirtyChange]);

  async function save() {
    if (dirty.length === 0 || invalid.length > 0) return;
    setBusy(true);
    setError(null);

    const r = await postJson<{ message?: string }>("/api/inventory/count", {
      action: "save",
      countId,
      entries: dirty.map((row) => ({
        productId: row.productId,
        actual: (values[row.productId] ?? "").trim() === "" ? null : values[row.productId].trim(),
        /* الوحدةُ تُرسَل مع الرقم، والتحويلُ في الخادم */
        unit: units[row.productId] ?? row.baseUnit,
      })),
    });

    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSent(Object.fromEntries(dirty.map((row) => [row.productId, values[row.productId] ?? ""])));
    toast({ tone: "ok", title: String(r.data.message ?? "حُفظ العدّ."), body: "والفرقُ محسوبٌ في الخادم — تجده في «ماذا اختلف؟»." });
    router.refresh();
  }

  /** Enter ينتقل إلى الصنف التالي — لا يرسل نموذجاً ولا يُغلق شيئاً. */
  function onKey(e: React.KeyboardEvent<HTMLInputElement>, at: number) {
    if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
      e.preventDefault();
      inputs.current[at + 1]?.focus();
      inputs.current[at + 1]?.select();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      inputs.current[at - 1]?.focus();
      inputs.current[at - 1]?.select();
    }
  }

  const editable = canEdit && !locked;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-bold">{locked ? "ما وُجد على الرفّ" : "اكتب ما وجدتَه على الرفّ"}</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            {locked
              ? "العدُّ كما أُقفل — مجمَّد."
              : "صنفاً صنفاً، و«Enter» ينقلك إلى التالي. اترك ما لم تعدّه فارغاً — الفراغُ «لم يُعَدّ»، والتخمينُ يُحسَب عليه فرق."}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <p className="flex items-baseline justify-between text-xs">
            <span className="font-bold">عُدّ <span className="nums">{counted}</span> من <span className="nums">{rows.length}</span></span>
            {rows.length > 0 && <span className="nums text-muted">{Math.round((counted / rows.length) * 100)}٪</span>}
          </p>
          <div className="mt-1.5"><Meter value={counted} max={rows.length} tone={counted === rows.length ? "ok" : "accent"} label="تقدّم العدّ" /></div>
        </div>
      </div>

      <Toolbar query={query} setQuery={setQuery} category={category} setCategory={setCategory} categories={categories}>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line-input bg-raised px-3 text-xs font-medium sm:min-h-9">
          <input
            type="checkbox"
            checked={onlyUncounted}
            onChange={(e) => setOnlyUncounted(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          ما لم يُعَدّ بعد
        </label>
      </Toolbar>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
          {onlyUncounted ? "عُدّت الأصنافُ كلُّها." : "لا صنفَ يطابق هذا الترشيح."}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
          {visible.map((row, at) => {
            const value = values[row.productId] ?? "";
            const changed = value !== (initial[row.productId] ?? "");
            const bad = changed && !validQuantity(value);
            const d = row.direction;
            return (
              <li
                key={row.productId}
                className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2.5 border-b border-line-soft px-4 py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto_9rem] ${changed ? "bg-accent-soft/35" : ""}`}
              >
                <div className="col-span-2 min-w-0 md:col-span-1">
                  <p className="truncate text-[14px] font-bold">{row.productName}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    المتوقَّع:{" "}
                    <span className={row.expected ? "nums font-bold text-ink-soft" : "text-warn"}>{row.expected === null ? "غير معروف" : `${row.expected} ${row.unitLabel}`}</span>
                    {row.flags.length > 0 && row.expected === null && <span className="text-warn"> · {row.flags[0]}</span>}
                  </p>
                </div>

                <label className="flex min-w-0 items-center gap-2">
                  <span className="sr-only">{`العدّ الفعليّ لـ${row.productName} بـ${row.unitLabel}`}</span>
                  <input
                    ref={(el) => { inputs.current[at] = el; }}
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="next"
                    autoComplete="off"
                    dir="ltr"
                    disabled={!editable || busy}
                    value={value}
                    aria-invalid={bad || undefined}
                    onChange={(e) => setValues((v) => ({ ...v, [row.productId]: e.target.value }))}
                    onKeyDown={(e) => onKey(e, at)}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="—"
                    className={`nums h-14 w-full min-w-0 rounded-xl border-2 px-3 text-center text-xl font-bold transition-colors sm:w-32 md:h-12 md:text-lg ${
                      bad ? "border-danger bg-danger-bg" : changed ? "border-accent bg-raised" : "border-line-input bg-raised"
                    } disabled:bg-sunken disabled:text-ink-soft`}
                  />
                  {row.unitChoices.length > 1 ? (
                    <select
                      aria-label={`وحدةُ عدّ ${row.productName}`}
                      disabled={!editable || busy}
                      value={units[row.productId] ?? row.baseUnit}
                      onChange={(e) => setUnits((u) => ({ ...u, [row.productId]: e.target.value }))}
                      className="h-14 shrink-0 rounded-xl border border-line-input bg-raised px-2 text-sm md:h-12"
                    >
                      {row.unitChoices.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="w-12 shrink-0 text-xs text-muted">{row.unitLabel}</span>
                  )}
                </label>

                {/* الفرقُ من الخادم وحده — وما كُتب ولم يُحفَظ يُقال إنّه لم يُحسَب بعد */}
                <div className="min-w-0 text-end md:text-start">
                  {changed ? (
                    <p className={`text-[11px] ${bad ? "font-bold text-danger" : "text-muted"}`}>{bad ? "رقمٌ لا يُقرأ" : "يُحسَب بعد الحفظ"}</p>
                  ) : row.varianceText && d ? (
                    <>
                      <p className={`flex items-center justify-end gap-1 text-[13px] font-bold md:justify-start ${DIRECTION[d].text}`}>
                        {(() => { const I = DIRECTION[d].icon; return <I className="h-3.5 w-3.5" strokeWidth={2.25} aria-label={DIRECTION[d].label} />; })()}
                        <span className="nums">{row.varianceText}</span>
                      </p>
                      <p className="text-[11px] text-muted">
                        <span className="nums">{row.varianceBpText}</span>
                        {row.varianceCostMinor !== null && <> · <Money minor={Math.abs(row.varianceCostMinor)} /></>}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted">{value.trim() === "" ? "لم يُعَدّ" : "فرقٌ غير محسوب"}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editable && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mt-5 lg:bottom-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-overlay/95 px-4 py-3 shadow-overlay backdrop-blur">
            <p className="min-w-0 flex-1 text-[13px]">
              {dirty.length === 0
                ? <span className="text-muted">كلُّ ما كتبتَه محفوظ — المسوّدةُ تبقى، والإقفالُ فعلٌ مستقلّ.</span>
                : invalid.length > 0
                  ? <span className="font-bold text-danger">{countNoun(invalid.length, PRODUCT)} برقمٍ لا يُقرأ — صحّحه قبل الحفظ.</span>
                  : <span className="font-bold">{countNoun(dirty.length, PRODUCT)} لم يُحفَظ بعد</span>}
            </p>
            {error && <p role="alert" className="w-full text-xs text-danger sm:order-last">{error}</p>}
            <button
              type="button"
              onClick={save}
              disabled={busy || dirty.length === 0 || invalid.length > 0}
              className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
            >
              {busy ? "يُحفظ…" : dirty.length === 0 ? "لا تغييرَ يُحفظ" : `احفظ العدّ (${dirty.length})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * أيُقرأ هذا رقماً؟ — فحصٌ للعين قبل الإرسال، والحكمُ للخادم.
 *
 * الفارغُ مقبول (يعني «أفرِغ العدّ»)، والعدد العشريّ بنقطةٍ أو فاصلة.
 */
function validQuantity(v: string): boolean {
  if (v.trim() === "") return true;
  const milli = decimalToMilli(v);
  return milli !== null && milli >= 0;
}
