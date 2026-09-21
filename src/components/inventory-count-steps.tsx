"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { InventoryCountEntry, type CountRow } from "./inventory-count-entry";

/**
 * الجردُ ثلاثُ خطوات، بترتيبِ ما يجري على الرفّ.
 *
 *   ‏١ · ما الذي يُعَدّ؟   ‏٢ · كم تقول المبيعاتُ إنّه استُهلك؟   ‏٣ · كم وجدتَ؟
 *
 * ── ولماذا هذا الترتيب بعينه ──
 *
 * كانت الشاشة تفتح على خانات العدّ مباشرةً، فيرى صاحبُ المقهى ستّين
 * صنفاً وعمودَ «المتوقَّع» بلا أن يعرف **من أين جاء** ولا أنّ له أن
 * يُخرج منها ما لا يعدّه. فيملأ ما يقدر عليه ويخمّن الباقي — **وتخمينٌ
 * في خانة الفعليّ أسوأ من فراغ**: الفراغُ يقول «لم يُعَدّ»، والتخمينُ
 * يقول «هذا ما على الرفّ» فيُحسَب عليه فرقٌ ويُبنى عليه قرار.
 *
 * فصار يختار أوّلاً، ثمّ يقرأ المعادلة التي ستُحاسِبه، ثمّ يعدّ.
 * ومن قرأ الخطوة الثانية عرف أنّ الفرق **فرقٌ بين رقمين محسوبين**
 * لا حكماً ينزل عليه.
 */
export interface StepRow extends CountRow {
  inScope: boolean;
  /** حدودُ المعادلة نصّاً بوحدة الصنف — و«غير معروف» تبقى نصّاً لا صفراً. */
  openingText: string | null;
  purchasesText: string | null;
  adjustmentsText: string | null;
  consumptionText: string | null;
  wasteText: string | null;
}

type Step = 1 | 2 | 3;

export function InventoryCountSteps({
  countId,
  rows,
  categories,
  canEdit,
  locked,
  scopeInherited,
}: {
  countId: string;
  rows: StepRow[];
  categories: { key: string; label: string }[];
  canEdit: boolean;
  locked: boolean;
  /** أمورَّثٌ هذا النطاق من الجرد السابق؟ — يُقال، فلا يُظنّ أنّه اختيارُ اليوم. */
  scopeInherited: boolean;
}) {
  const counted = rows.filter((r) => r.inScope && r.actual.trim() !== "").length;
  const [step, setStep] = useState<Step>(() => (counted > 0 || locked ? 3 : 1));

  const inScope = rows.filter((r) => r.inScope);

  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="خطوات الجرد">
        <StepTab n={1} now={step} go={setStep} label="ما الذي يُعَدّ؟" count={`${inScope.length} من ${rows.length}`} />
        <StepTab n={2} now={step} go={setStep} label="ما تقوله المبيعات" count={`${inScope.filter((r) => r.consumptionText !== null).length} محسوب`} />
        <StepTab n={3} now={step} go={setStep} label="كم وجدتَ؟" count={`${counted} من ${inScope.length}`} />
      </nav>

      {step === 1 && (
        <ScopePicker
          countId={countId}
          rows={rows}
          categories={categories}
          canEdit={canEdit && !locked}
          inherited={scopeInherited}
          onDone={() => setStep(2)}
        />
      )}

      {step === 2 && <EquationView rows={inScope} onDone={() => setStep(3)} />}

      {step === 3 && (
        <InventoryCountEntry
          countId={countId}
          rows={inScope}
          categories={categories}
          canEdit={canEdit}
          locked={locked}
        />
      )}
    </div>
  );
}

function StepTab({
  n, now, go, label, count,
}: {
  n: Step; now: Step; go: (s: Step) => void; label: string; count: string;
}) {
  const active = now === n;
  return (
    <button
      type="button"
      onClick={() => go(n)}
      aria-current={active ? "step" : undefined}
      className={`min-h-11 rounded-xl border px-3 py-1.5 text-start text-xs ${
        active ? "border-ink bg-inverse-surface text-inverse-ink" : "border-line hover:border-ink-soft"
      }`}
    >
      <span className="nums font-bold">{n}</span> · <span className="font-bold">{label}</span>
      <span className={`nums block text-[11px] ${active ? "opacity-80" : "text-muted"}`}>{count}</span>
    </button>
  );
}

/* ─────────────────────── ١ · ما الذي يُعَدّ؟ ─────────────────────── */

function ScopePicker({
  countId, rows, categories, canEdit, inherited, onDone,
}: {
  countId: string;
  rows: StepRow[];
  categories: { key: string; label: string }[];
  canEdit: boolean;
  inherited: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.inScope])),
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (category && r.category !== category) return false;
      if (q && !r.productName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, category]);

  const changed = rows.filter((r) => picked[r.productId] !== r.inScope);
  const chosen = rows.filter((r) => picked[r.productId]).length;

  async function save() {
    if (changed.length === 0) { onDone(); return; }
    setBusy(true);
    setError(null);
    setSaved(null);

    /* مجموعتان لا صنفٌ صنف — فلا يبقى نصفُ الاختيار مكتوباً إن سقط الطلب */
    for (const inScope of [true, false]) {
      const ids = changed.filter((r) => picked[r.productId] === inScope).map((r) => r.productId);
      if (ids.length === 0) continue;
      const res = await postJson("/api/inventory/count", {
        action: "scope", countId, productIds: ids, inScope,
      });
      if (!res.ok) { setBusy(false); setError(res.error); return; }
    }

    setBusy(false);
    setSaved(`حُفظ النطاق — يُعَدّ ${chosen} صنفاً.`);
    router.refresh();
    onDone();
  }

  function setAll(value: boolean) {
    setPicked((p) => {
      const next = { ...p };
      for (const r of visible) next[r.productId] = value;
      return next;
    });
  }

  return (
    <div>
      <p className="mb-3 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        اختر ما ستعدّه على الرفّ. <strong>والخارجُ ليس صفراً</strong>: تُحسَب مشترياتُه
        واستهلاكُه المتوقَّع ويُعرضان، ولا يُحسَب له فرقٌ ولا يدخل مجاميعَ التقرير — لأنّ
        الفرق يقتضي عدّاً، ولا عدّ. ويبقى ما أدخلتَه من عدٍّ محفوظاً إن أعدتَه.
        {inherited && (
          <> <strong className="text-warn">وهذا الاختيار موروثٌ من جردك السابق</strong> — غيِّره متى شئت.</>
        )}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن صنف…"
          aria-label="ابحث عن صنف"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-sm"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="رشِّح بالباب"
          className="min-h-11 rounded-xl border border-line bg-raised px-3 text-xs"
        >
          <option value="">كلّ الأبواب</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {canEdit && (
          <>
            <button type="button" onClick={() => setAll(true)} className={buttonClass("secondary", "sm")}>
              أدخِل المعروض
            </button>
            <button type="button" onClick={() => setAll(false)} className={buttonClass("secondary", "sm")}>
              أخرِج المعروض
            </button>
          </>
        )}
        <span className="nums text-xs text-muted">{chosen} / {rows.length}</span>
      </div>

      <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
        {visible.map((row) => (
          <li key={row.productId}>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2.5">
              <input
                type="checkbox"
                disabled={!canEdit || busy}
                checked={picked[row.productId] ?? true}
                onChange={(e) => setPicked((p) => ({ ...p, [row.productId]: e.target.checked }))}
                className="h-4 w-4 shrink-0 accent-[var(--ink)]"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold">{row.productName}</span>
                <span className="block text-[11px] text-muted">
                  {row.categoryLabel} · يُعَدّ بـ{row.unitLabel}
                  {row.actual.trim() !== "" && <span className="nums"> · عُدّ: {row.actual}</span>}
                </span>
              </span>
              {picked[row.productId] !== row.inScope && (
                <span className="shrink-0 text-[11px] text-warn">غُيِّر</span>
              )}
            </label>
          </li>
        ))}
      </ul>

      {visible.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
          لا صنفَ يطابق هذا الترشيح.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {canEdit ? (
          <button type="button" onClick={save} disabled={busy} className={buttonClass("primary")}>
            {busy ? "يُحفظ…" : changed.length === 0 ? "تابِع" : `احفظ النطاق (${changed.length} تغييراً)`}
          </button>
        ) : (
          <button type="button" onClick={onDone} className={buttonClass("primary")}>تابِع</button>
        )}
        {error && <span className="text-xs text-danger">{error}</span>}
        {saved && <span className="text-xs text-ok">{saved}</span>}
      </div>
    </div>
  );
}

/* ──────────────── ٢ · ما تقوله المبيعات: المعادلة ──────────────── */

/**
 * المعادلةُ تُقرأ قبل أن يُعَدّ الرفّ.
 *
 * وهذه هي التي تُحاسِب: **افتتاحيّ + مشتريات + إضافات − استهلاك
 * متوقَّع − هدر = المتوقَّع على الرفّ**. والاستهلاكُ المتوقَّع محسوبٌ
 * من المبيعات بوصفاتها — لا مقدَّرٌ ولا مأخوذٌ من نقاط البيع.
 *
 * و**المجهولُ يُنشَر ولا يُبتَلع**: حدٌّ واحدٌ غيرُ معروف يجعل
 * المتوقَّعَ غيرَ معروف. ولو جُمع ما عداه لخرج رقمٌ يبدو دقيقاً وهو
 * أقلُّ من الحقّ، ثمّ حُوسب عليه صاحبُ المقهى.
 */
function EquationView({ rows, onDone }: { rows: StepRow[]; onDone: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const visible = q === "" ? rows : rows.filter((r) => r.productName.toLowerCase().includes(q));

  const computed = rows.filter((r) => r.consumptionText !== null).length;
  const blind = rows.filter((r) => r.expected === null).length;

  return (
    <div>
      <p className="mb-3 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        هذه هي المعادلة التي يُحسَب بها فرقُك:{" "}
        <strong>افتتاحيّ + مشتريات + إضافات − استهلاك متوقَّع − هدر = المتوقَّع على الرفّ</strong>.
        والاستهلاكُ المتوقَّع محسوبٌ من مبيعات الفترة بوصفاتها — نسخةِ الوصفة السارية{" "}
        <strong>في تاريخ كلّ بيعة</strong>، لا الأحدث.
        {" "}حُسب لـ<span className="nums">{computed}</span> من <span className="nums">{rows.length}</span> صنفاً
        {blind > 0 && (
          <>، و<span className="nums">{blind}</span> منها متوقَّعُه غيرُ معروف لأنّ حدّاً في معادلته غيرُ معروف —
          وتلك تُعَدّ ويُعرَض عدُّها بلا فرق.</>
        )}
      </p>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحث عن صنف…"
        aria-label="ابحث عن صنف"
        className="mb-3 min-h-11 w-full rounded-xl border border-line bg-raised px-3 text-sm"
      />

      <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
        {visible.map((row) => (
          <li key={row.productId} className="px-3 py-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="min-w-0 flex-1 truncate text-xs font-bold">{row.productName}</p>
              <p className="text-[11px] text-muted">بـ{row.unitLabel}</p>
            </div>

            <dl className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
              <Term label="افتتاحيّ" value={row.openingText} />
              <Op>+</Op>
              <Term label="مشتريات" value={row.purchasesText} />
              {row.adjustmentsText !== null && (
                <>
                  <Op>±</Op>
                  <Term label="إضافات" value={row.adjustmentsText} />
                </>
              )}
              <Op>−</Op>
              <Term label="استهلاكٌ متوقَّع" value={row.consumptionText} strong />
              {row.wasteText !== null && (
                <>
                  <Op>−</Op>
                  <Term label="هدرٌ مسجَّل" value={row.wasteText} />
                </>
              )}
              <Op>=</Op>
              <Term label="يُتوقَّع على الرفّ" value={row.expected} strong />
            </dl>

            {row.flags.length > 0 && (
              <p className="mt-1 text-[11px] text-warn">{row.flags[0]}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-4">
        <button type="button" onClick={onDone} className={buttonClass("primary")}>
          فهمتُ — أدخِل ما وجدتَه
        </button>
      </div>
    </div>
  );
}

function Term({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <dt className="text-muted">{label}</dt>
      <dd className={value === null ? "text-warn" : `nums ${strong ? "font-bold" : ""}`}>
        {value ?? "غير معروف"}
      </dd>
    </span>
  );
}

function Op({ children }: { children: string }) {
  return <span aria-hidden className="text-muted">{children}</span>;
}
