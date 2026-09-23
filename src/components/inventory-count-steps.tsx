"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { InventoryCountEntry, type CountRow } from "./inventory-count-entry";
import { FlowStep, type DuplicateRow, type ReceiptRow } from "./inventory-flow-step";

/**
 * الجردُ خمسُ خطوات، بترتيبِ ما يجري على الرفّ.
 *
 *   ‏١ · ما الذي نعدّه؟
 *   ‏٢ · ما الذي دخل وما الذي خرج؟ — ومعه فعلُ كلّ مجهول
 *   ‏٣ · كم وجدنا؟
 *   ‏٤ · ماذا اختلف؟ — النقصُ والزيادةُ لا يتقاصّان
 *   ‏٥ · أقفل الجرد
 *
 * ── ولماذا هذا الترتيب بعينه ──
 *
 * كانت الشاشة تفتح على خانات العدّ مباشرةً، فيرى صاحبُ المقهى ستّين
 * صنفاً وعمودَ «المتوقَّع» بلا أن يعرف **من أين جاء** ولا أنّ له أن
 * يُخرج منها ما لا يعدّه. فيملأ ما يقدر عليه ويخمّن الباقي — **وتخمينٌ
 * في خانة الفعليّ أسوأ من فراغ**: الفراغُ يقول «لم يُعَدّ»، والتخمينُ
 * يقول «هذا ما على الرفّ» فيُحسَب عليه فرقٌ ويُبنى عليه قرار.
 *
 * ومن قرأ الخطوة الثانية عرف أنّ الفرق **فرقٌ بين رقمين محسوبين**
 * لا حكماً ينزل عليه — ووجد بجانب كلّ مجهولٍ ما يُدخله به.
 */
export interface StepRow extends CountRow {
  inScope: boolean;
  /** حدودُ المعادلة نصّاً بوحدة الصنف — و`null` تبقى «غير معروف» لا صفراً. */
  openingText: string | null;
  /** ومن أين جاء: «أُدخل يدوياً» · «من جرد الأسبوع السابق» … */
  openingSourceLabel: string;
  openingManual: boolean;
  /** ما أُدخل يدوياً بوحدته كما كُتب — يُملأ به المحرّرُ عند التعديل. */
  openingEntered: string | null;
  openingEnteredUnit: string | null;
  purchasesText: string | null;
  /** صفرٌ بدليل: «لا مشتريات» — غيرُ «كمّيّة المشتريات غير معروفة». */
  purchasesZero: boolean;
  manualReceiptsText: string | null;
  adjustmentsText: string | null;
  consumptionText: string | null;
  wasteText: string | null;
}

type Step = 1 | 2 | 3 | 4 | 5;

export function InventoryCountSteps({
  countId,
  branchId,
  periodStart,
  periodEnd,
  defaultReceiptDate,
  rows,
  categories,
  receipts,
  duplicates,
  suppliers,
  canEdit,
  locked,
  scopeInherited,
  scopeExplicit,
  review,
  finalise,
}: {
  countId: string;
  branchId: string | null;
  periodStart: string;
  periodEnd: string;
  defaultReceiptDate: string;
  rows: StepRow[];
  categories: { key: string; label: string }[];
  receipts: ReceiptRow[];
  duplicates: DuplicateRow[];
  suppliers: { id: string; name: string }[];
  canEdit: boolean;
  locked: boolean;
  /** أمورَّثٌ هذا النطاق من الجرد السابق؟ — يُقال، فلا يُظنّ أنّه اختيارُ اليوم. */
  scopeInherited: boolean;
  /** أحفظه إنسانٌ هنا؟ — فلا يمسّه التوريث بعدها. */
  scopeExplicit: boolean;
  /** ‏٤ · ماذا اختلف — يُرسَم في الخادم ويُمرَّر. */
  review: ReactNode;
  /** ‏٥ · الإقفال. */
  finalise: ReactNode;
}) {
  const counted = rows.filter((r) => r.inScope && r.actual.trim() !== "").length;
  const [step, setStep] = useState<Step>(() => (locked ? 4 : counted > 0 ? 3 : scopeExplicit ? 2 : 1));

  const inScope = rows.filter((r) => r.inScope);
  const unknownInputs = inScope.filter((r) => r.openingText === null || r.purchasesText === null).length;

  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="خطوات الجرد">
        <StepTab n={1} now={step} go={setStep} label="ما الذي نعدّه؟" count={`${inScope.length} من ${rows.length}`} />
        <StepTab
          n={2} now={step} go={setStep} label="ما الذي دخل وما الذي خرج؟"
          count={unknownInputs > 0 ? `${unknownInputs} ينقصه شيء` : "المعادلةُ معروفة"}
          warn={unknownInputs > 0}
        />
        <StepTab n={3} now={step} go={setStep} label="كم وجدنا؟" count={`${counted} من ${inScope.length}`} />
        <StepTab n={4} now={step} go={setStep} label="ماذا اختلف؟" count="النقصُ والزيادة" />
        <StepTab n={5} now={step} go={setStep} label={locked ? "حالُ الجرد" : "أقفل الجرد"} count={locked ? "مقفَل" : "بعد المراجعة"} />
      </nav>

      {step === 1 && (
        <ScopePicker
          countId={countId}
          rows={rows}
          categories={categories}
          canEdit={canEdit && !locked}
          inherited={scopeInherited}
          explicit={scopeExplicit}
          onDone={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <FlowStep
          countId={countId}
          branchId={branchId}
          periodStart={periodStart}
          periodEnd={periodEnd}
          defaultReceiptDate={defaultReceiptDate}
          rows={inScope}
          categories={categories}
          receipts={receipts}
          duplicates={duplicates}
          suppliers={suppliers}
          canEdit={canEdit && !locked}
          onDone={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <div>
          <InventoryCountEntry
            countId={countId}
            rows={inScope}
            categories={categories}
            canEdit={canEdit}
            locked={locked}
          />
          <div className="mt-4">
            <button type="button" onClick={() => setStep(4)} className={buttonClass("secondary")}>
              تابِع — ماذا اختلف؟
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          {review}
          {!locked && (
            <div className="mt-4">
              <button type="button" onClick={() => setStep(5)} className={buttonClass("secondary")}>
                تابِع — أقفل الجرد
              </button>
            </div>
          )}
        </div>
      )}

      {step === 5 && finalise}
    </div>
  );
}

function StepTab({
  n, now, go, label, count, warn,
}: {
  n: Step; now: Step; go: (s: Step) => void; label: string; count: string; warn?: boolean;
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
      <span className={`nums block text-[11px] ${active ? "opacity-80" : warn ? "text-warn" : "text-muted"}`}>{count}</span>
    </button>
  );
}

/* ─────────────────────── ١ · ما الذي يُعَدّ؟ ─────────────────────── */

function ScopePicker({
  countId, rows, categories, canEdit, inherited, explicit, onDone,
}: {
  countId: string;
  rows: StepRow[];
  categories: { key: string; label: string }[];
  canEdit: boolean;
  inherited: boolean;
  explicit: boolean;
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

  /*
    ── طلبٌ واحد بالمجموعتين ──

    كان طلبين (الداخل ثمّ الخارج)؛ فإن سقط الثاني بقي النطاقُ نصفَ
    مكتوب. والخادمُ يكتبهما في معاملةٍ واحدة أو لا يكتب شيئاً، ويصير
    النطاقُ بعدها صريحاً لا يمسّه التوريث — ولو لم يتغيّر فيه شيء:
    «أبقِه كما ورثتُه» اختيارٌ كذلك.
  */
  async function save() {
    if (changed.length === 0 && explicit) { onDone(); return; }
    setBusy(true);
    setError(null);
    setSaved(null);

    const res = await postJson("/api/inventory/count", {
      action: "scope",
      countId,
      included: rows.filter((r) => picked[r.productId]).map((r) => r.productId),
      excluded: rows.filter((r) => !picked[r.productId]).map((r) => r.productId),
    });

    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
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
        {!explicit && inherited && (
          <> <strong className="text-warn">وهذا الاختيار موروثٌ من جردك السابق ولم تحفظه بعد</strong> — احفظه كما هو أو غيِّره.</>
        )}
        {explicit && <> <strong>وهذا نطاقٌ حفظتَه لهذا الجرد</strong> — لا يتغيّر بتغيّر الجرد السابق.</>}
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
            {busy ? "يُحفظ…"
              : changed.length > 0 ? `احفظ النطاق (${changed.length} تغييراً)`
                : explicit ? "تابِع" : "احفظه كما هو وتابِع"}
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
