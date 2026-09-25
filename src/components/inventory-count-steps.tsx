"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { toast } from "./ui-client";
import { InventoryCountEntry, type CountRow } from "./inventory-count-entry";
import { FlowStep, type DuplicateRow, type ReceiptRow } from "./inventory-flow-step";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { Toolbar } from "./inventory-toolbar";
import { STEP_ORDER as ORDER, type StepId } from "./inventory-ui";

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
 * ── والخطواتُ كلُّها مرسومة، والظاهرُ واحدة ──
 *
 * كانت الخطوةُ تُهدَم حين يُنتقَل منها، فمن كتب عشرين عدّاً ثمّ ضغط
 * «تابِع» قبل «احفظ» فقدها بلا كلمة. فصارت تُخفى ولا تُهدَم، ويُنبَّه
 * على ما لم يُحفَظ قبل مغادرة الصفحة.
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

export type { StepId } from "./inventory-ui";

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
  measured,
  initialStep,
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
  /** أحُسب فرقُ صنفٍ واحد؟ */
  measured: boolean;
  initialStep: StepId | null;
  /** ‏٤ · ماذا اختلف — يُرسَم في الخادم ويُمرَّر. */
  review: ReactNode;
  /** ‏٥ · الإقفال. */
  finalise: ReactNode;
}) {
  const inScope = rows.filter((r) => r.inScope);
  const counted = inScope.filter((r) => r.actual.trim() !== "").length;
  const unknownInputs = inScope.filter((r) => r.openingText === null || r.purchasesText === null).length;

  const natural: StepId = locked ? "review" : counted > 0 ? "count" : scopeExplicit ? "flow" : "scope";
  const [step, setStep] = useState<StepId>(initialStep ?? natural);
  const [dirtyCount, setDirtyCount] = useState(0);

  /* رابطٌ بـ`?step=` من داخل الصفحة (فجوةٌ تُحسَم في الخطوة الثانية) يحرّك الخطوة */
  const [seenStep, setSeenStep] = useState(initialStep);
  if (seenStep !== initialStep) {
    setSeenStep(initialStep);
    if (initialStep) setStep(initialStep);
  }

  /* العدُّ الذي لم يُحفَظ لا يضيع بإغلاق الصفحة صامتاً */
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  function go(next: StepId) {
    setStep(next);
    /* الخطوةُ في العنوان — فتحديثُ الصفحة يعيدك إليها، والرابطُ يُشارَك */
    const url = new URL(window.location.href);
    url.searchParams.set("step", next);
    window.history.replaceState(null, "", url);
    document.getElementById("count-steps")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const meta: Record<StepId, { title: string; status: string; done: boolean; warn?: boolean }> = {
    scope: {
      title: "ما الذي نعدّه؟",
      status: `${inScope.length} من ${rows.length}`,
      done: locked || scopeExplicit,
    },
    flow: {
      title: "ما دخل وما خرج",
      status: unknownInputs > 0 ? `${unknownInputs} ينقصه حدّ` : "المعادلةُ معروفة",
      done: locked || unknownInputs === 0,
      warn: !locked && unknownInputs > 0,
    },
    count: {
      title: "كم وجدنا؟",
      status: `عُدّ ${counted} من ${inScope.length}`,
      done: locked || (inScope.length > 0 && counted === inScope.length),
    },
    review: {
      title: "ماذا اختلف؟",
      status: measured ? "النقصُ والزيادة" : "لم يُحسَب بعد",
      done: locked,
    },
    close: {
      title: locked ? "حالُ الجرد" : "أقفِل الجرد",
      status: locked ? "مقفَل" : "بعد المراجعة",
      done: locked,
    },
  };

  const at = ORDER.indexOf(step);
  const doneCount = ORDER.filter((s) => meta[s].done).length;
  const prev = at > 0 ? ORDER[at - 1] : null;
  const next = at < ORDER.length - 1 ? ORDER[at + 1] : null;

  return (
    <div id="count-steps" className="scroll-mt-24">
      <StepNav order={ORDER} meta={meta} current={step} go={go} doneCount={doneCount} />

      <div className="mt-6">
        <div hidden={step !== "scope"}>
          <ScopePicker
            countId={countId}
            rows={rows}
            categories={categories}
            canEdit={canEdit && !locked}
            inherited={scopeInherited}
            explicit={scopeExplicit}
            onDone={() => go("flow")}
          />
        </div>

        <div hidden={step !== "flow"}>
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
          />
        </div>

        <div hidden={step !== "count"}>
          <InventoryCountEntry
            countId={countId}
            rows={inScope}
            categories={categories}
            canEdit={canEdit}
            locked={locked}
            onDirtyChange={setDirtyCount}
          />
        </div>

        {/* عنصرٌ بناه الخادم لا يقف أخاً لغيره في مصفوفة أبناء — وإلّا طلب React مفتاحاً له */}
        <div hidden={step !== "review"}>{review}</div>
        <div hidden={step !== "close"}>{finalise}</div>
      </div>

      {/* ── السابق والتالي في ذيل كلّ خطوة — لا يُبحَث عن الطريق ── */}
      {step !== "scope" && (
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {prev ? (
            <button type="button" onClick={() => go(prev)} className={buttonClass("quiet")}>
              <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />
              {meta[prev].title}
            </button>
          ) : <span />}
          {next && (
            <div className="flex flex-wrap items-center gap-3">
              {step === "count" && dirtyCount > 0 && (
                <span className="flex items-center gap-1.5 text-xs text-warn">
                  <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {countNoun(dirtyCount, PRODUCT)} لم يُحفَظ بعد
                </span>
              )}
              <button type="button" onClick={() => go(next)} className={buttonClass("primary")}>
                التالي: {meta[next].title}
                <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── شريطُ الخطوات ─────────────────────── */

/**
 * الخطواتُ الخمس وتقدّمُها — على الحاسوب صفٌّ واحد، وعلى الجوّال عنوانُ
 * الخطوة الحاليّة وشريطُ تقدّمٍ ونقاطٌ تُلمَس. ولا تُقفَل خطوة: يعود إليها
 * من شاء، والترتيبُ نصيحةٌ لا حاجز.
 */
function StepNav({
  order, meta, current, go, doneCount,
}: {
  order: readonly StepId[];
  meta: Record<StepId, { title: string; status: string; done: boolean; warn?: boolean }>;
  current: StepId;
  go: (s: StepId) => void;
  doneCount: number;
}) {
  const at = order.indexOf(current);
  return (
    <nav aria-label="خطوات الجرد" className="rounded-2xl border border-line bg-raised p-2 shadow-raised">
      {/* الجوّال: الخطوةُ الحاليّة بالاسم، والباقي نقاط */}
      <div className="px-2 pb-2 pt-1.5 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold">
            <span className="text-muted">الخطوة <span className="nums">{at + 1}</span> من <span className="nums">{order.length}</span> · </span>
            {meta[current].title}
          </p>
          <p className="nums shrink-0 text-[11px] text-muted">{meta[current].status}</p>
        </div>
        <div className="mt-2.5 flex gap-1.5">
          {order.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => go(s)}
              aria-label={`${i + 1} · ${meta[s].title}`}
              aria-current={s === current ? "step" : undefined}
              className="group flex min-h-11 flex-1 items-center"
            >
              <span className={`block h-1.5 w-full rounded-full transition-colors ${
                s === current ? "bg-accent" : meta[s].done ? "bg-ok" : meta[s].warn ? "bg-warn" : "bg-sunken"
              }`} />
            </button>
          ))}
        </div>
      </div>

      {/* الحاسوب: الخطواتُ صفّاً بأسمائها وحالها */}
      <ol className="hidden grid-cols-5 gap-1 md:grid">
        {order.map((s, i) => {
          const m = meta[s];
          const active = s === current;
          return (
            <li key={s} className="min-w-0">
              <button
                type="button"
                onClick={() => go(s)}
                aria-current={active ? "step" : undefined}
                className={`flex min-h-14 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start transition-colors ${
                  active ? "bg-accent-soft ring-1 ring-accent-line" : "hover:bg-hover"
                }`}
              >
                <span
                  aria-hidden
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${
                    active ? "border-accent bg-accent text-accent-ink"
                      : m.done ? "border-ok bg-ok text-raised"
                        : m.warn ? "border-warn/60 bg-warn-bg text-warn"
                          : "border-line bg-raised text-muted"
                  }`}
                >
                  {m.done && !active ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="nums">{i + 1}</span>}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-[13px] font-bold ${active ? "text-accent" : ""}`}>{m.title}</span>
                  <span className={`nums block truncate text-[11px] ${m.warn ? "text-warn" : "text-muted"}`}>{m.status}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite">{`تمّ ${doneCount} من ${order.length}`}</p>
    </nav>
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

    const res = await postJson("/api/inventory/count", {
      action: "scope",
      countId,
      included: rows.filter((r) => picked[r.productId]).map((r) => r.productId),
      excluded: rows.filter((r) => !picked[r.productId]).map((r) => r.productId),
    });

    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast({ tone: "ok", title: `حُفظ النطاق — يُعَدّ ${countNoun(chosen, PRODUCT)}.` });
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
      <div className="mb-4 max-w-3xl">
        <h2 className="text-base font-bold">اختر ما ستعدّه على الرفّ</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          <strong>والخارجُ ليس صفراً</strong>: تُحسَب مشترياتُه واستهلاكُه المتوقَّع ويُعرضان، ولا يُحسَب له فرقٌ
          ولا يدخل المجاميع — لأنّ الفرق يقتضي عدّاً. وما أدخلتَه من عدٍّ يبقى محفوظاً إن أعدتَه.
        </p>
        {!explicit && inherited && (
          <p className="mt-2 flex items-start gap-1.5 text-xs font-bold leading-relaxed text-warn">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            هذا الاختيار موروثٌ من جردك السابق ولم تحفظه بعد — احفظه كما هو أو غيِّره.
          </p>
        )}
        {explicit && <p className="mt-2 text-xs text-muted">نطاقٌ حفظتَه لهذا الجرد — لا يتغيّر بتغيّر الجرد السابق.</p>}
      </div>

      <Toolbar query={query} setQuery={setQuery} category={category} setCategory={setCategory} categories={categories}>
        {canEdit && (
          <>
            <button type="button" onClick={() => setAll(true)} className={buttonClass("secondary", "sm")}>أدخِل المعروض</button>
            <button type="button" onClick={() => setAll(false)} className={buttonClass("secondary", "sm")}>أخرِج المعروض</button>
          </>
        )}
      </Toolbar>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">لا صنفَ يطابق هذا الترشيح.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((row) => {
            const on = picked[row.productId] ?? true;
            return (
              <li key={row.productId}>
                <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                  on ? "border-accent-line bg-raised shadow-raised" : "border-line bg-sunken/50"
                } ${!canEdit || busy ? "cursor-default" : "hover:border-accent"}`}>
                  <input
                    type="checkbox"
                    disabled={!canEdit || busy}
                    checked={on}
                    onChange={(e) => setPicked((p) => ({ ...p, [row.productId]: e.target.checked }))}
                    className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[13px] font-bold ${on ? "" : "text-muted"}`}>{row.productName}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {row.categoryLabel} · يُعَدّ بـ{row.unitLabel}
                      {row.actual.trim() !== "" && <span className="nums"> · عُدّ: {row.actual}</span>}
                    </span>
                  </span>
                  {picked[row.productId] !== row.inScope && (
                    <span className="shrink-0 rounded-full bg-warn-bg px-2 py-0.5 text-[10px] font-bold text-warn">غُيِّر</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── شريطُ الحفظ ثابتٌ تحت الإبهام ── */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mt-5 lg:bottom-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-overlay/95 px-4 py-3 shadow-overlay backdrop-blur">
          <p className="min-w-0 flex-1 text-[13px]">
            <span className="font-bold">يُعَدّ {countNoun(chosen, PRODUCT)}</span>
            <span className="text-muted"> من {rows.length}</span>
            {changed.length > 0 && <span className="text-warn"> · {changed.length} تغييراً لم يُحفَظ</span>}
          </p>
          {error && <p role="alert" className="w-full text-xs text-danger sm:order-last">{error}</p>}
          {canEdit ? (
            <button type="button" onClick={save} disabled={busy || chosen === 0} className={buttonClass("primary")}>
              {busy ? "يُحفظ…"
                : changed.length > 0 ? "احفظ النطاق وتابِع"
                  : explicit ? "تابِع" : "احفظه كما هو وتابِع"}
              {!busy && <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />}
            </button>
          ) : (
            <button type="button" onClick={onDone} className={buttonClass("primary")}>
              تابِع <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
