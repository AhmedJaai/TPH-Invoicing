"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { ConfirmAction, Sheet, toast } from "./ui-client";
import { CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, CircleAlert, RefreshCw, Store, TriangleAlert } from "lucide-react";
import { weekOf, type Week } from "@/lib/inventory/week";
import { ITEM, countNoun } from "@/lib/arabic";
import { WEEK, formatWeek } from "./inventory-ui";
import { addDays, MS_PER_DAY } from "@/lib/riyadh-time";
import { T } from "@/components/i18n/t";

/**
 * يبدأ جردَ أسبوع.
 *
 * ── ولا يُختار تاريخان حرّان ──
 *
 * الجردُ أسبوعٌ من الأحد إلى السبت، فالشاشةُ تُظهر أسبوعاً وتتنقّل
 * بينه وبين جيرانه. وحقلا تاريخٍ حرّان يسمحان بفترةٍ تترك يومين خارج
 * كلّ جرد — ثمّ يردّها الخادمُ بعد الضغط. **والمنعُ قبل الفعل خيرٌ من
 * رسالة خطأ بعده.**
 */
export function StartCount({
  defaultStart,
  defaultEnd,
  branches,
  prerequisite = null,
  openWeekStart = null,
  onSameWeek,
  onRestart,
}: {
  defaultStart: string;
  defaultEnd: string;
  branches: { id: string; name: string }[];
  /** أسبوعُ جردٍ مفتوح — اختيارُه ثانيةً عودةٌ إليه لا جردٌ جديد. */
  openWeekStart?: string | null;
  onSameWeek?: () => void;
  /** يُلغى المفتوحُ ويُبدأ أسبوعُه من جديد — بإقرارٍ في الورقة. */
  onRestart?: () => Promise<boolean>;
  /**
   * ما ينقص قبل أن يُحسَب فرق — يُقال بجانب الزرّ ولا يمنعه.
   *
   * فالعدُّ على الرفّ لا ينتظر ملفّاً: يُحفَظ، ويُحسَب الفرقُ حين تصل
   * المبيعات. لكنّ من يبدأ بلا كتالوج يُقال له قبل أن يضغط، لا بعده.
   */
  prerequisite?: string | null;
}) {
  const router = useRouter();
  const [week, setWeek] = useState<Week>({ start: defaultStart, end: defaultEnd });
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* لا يُقترَح أسبوعٌ لم ينتهِ — فالفرقُ فيه أيّامٌ لم تمضِ لا فاقد */
  const atLatest = week.start >= defaultStart;
  const sameAsOpen = openWeekStart !== null && week.start === openWeekStart;

  async function begin() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ countId: string }>("/api/inventory/count", {
      action: "start",
      periodStart: week.start,
      periodEnd: week.end,
      branchId: branchId || null,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push(`/inventory/counts/${r.data.countId}`);
    router.refresh();
  }

  return (
    <section aria-labelledby="start-count-title" className="rounded-2xl border border-line bg-raised p-5 shadow-raised sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <CalendarRange className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="start-count-title" className="text-base font-bold">ابدأ جرد أسبوع</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            من الأحد إلى نهاية السبت. نجهّز لك ما بيع وما اشتريته في الأسبوع، وكل ما عليك أن تدخل ما وجدته على الرف.
          </p>
        </div>
      </div>

      {/* ── الأسبوعُ يُتنقَّل بين جيرانه — لا تاريخان حرّان ── */}
      <div className="mt-5 flex items-stretch gap-2">
        <button
          type="button"
          aria-label="الأسبوع السابق"
          onClick={() => setWeek(weekOf(addDays(week.start, -7)))}
          className={`${buttonClass("secondary", "md")} w-11 px-0 sm:w-11`}
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 rounded-xl border border-line bg-sunken/60 px-4 py-2.5 text-center" aria-live="polite">
          <p className="text-[15px] font-bold leading-snug sm:text-base">{formatWeek(week.start, week.end)}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {atLatest ? "آخر أسبوع مكتمل" : `قبل ${countNoun(Math.round((Date.parse(defaultStart) - Date.parse(week.start)) / (7 * MS_PER_DAY)), WEEK)}`}
          </p>
        </div>
        <button
          type="button"
          aria-label="الأسبوع التالي"
          disabled={atLatest}
          onClick={() => setWeek(weekOf(addDays(week.start, 7)))}
          className={`${buttonClass("secondary", "md")} w-11 px-0 sm:w-11`}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
        </button>
      </div>

      {branches.length > 1 && (
        <label className="mt-3 block">
          <span className="block text-[11px] font-medium text-muted">الفرع</span>
          <select
            value={branchId} onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
          >
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {branches.length === 1 && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Store className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {branches[0].name}
        </p>
      )}

      {prerequisite && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
          <span>{prerequisite}</span>
        </p>
      )}

      {sameAsOpen && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-accent-line bg-accent-soft/60 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
          <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
          <span>هذا أسبوع الجرد المفتوح نفسه. ارجع إليه وأكمله، أو اختر أسبوعاً آخر بالسهمين.</span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {sameAsOpen ? (
          <>
            <button type="button" onClick={onSameWeek} className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}>
              ارجع إلى الجرد المفتوح
            </button>
            {onRestart && (
              <ConfirmAction
                label="ألغِ الجرد وابدأ من جديد"
                title="جرد جديد للأسبوع نفسه"
                consequence="سيُحذف الجرد المفتوح لهذا الأسبوع ويبدأ جرد جديد فارغ. الأعداد التي أدخلتها لن تُنقل، وتبقى في سجل التدقيق فقط."
                acknowledgement="أفهم أن أعداد الجرد المفتوح لن تعود إلا إن أدخلتها من جديد."
                confirmLabel="ألغِ وابدأ"
                variant="quiet"
                size="md"
                onConfirm={onRestart}
              />
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={begin}
            aria-busy={busy}
            disabled={busy}
            className={`${buttonClass(prerequisite ? "secondary" : "primary", "lg")} w-full sm:w-auto`}
          >
            ابدأ جرد هذا الأسبوع
          </button>
        )}
        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-xs leading-relaxed text-danger">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * إقفالُ الجرد.
 *
 * والإقرارُ يقول ماذا يقع بالضبط: تُجمَّد الأرقام، وتُحفَظ أصولُها،
 * ولا يتغيّر التقريرُ بعدها مهما عُدّلت وصفةٌ أو وصلت فاتورة.
 */
export function FinaliseCount({
  countId,
  readiness,
  countedItems,
  totalItems,
}: {
  countId: string;
  readiness: "READY" | "PARTIAL" | "BLOCKED" | null;
  countedItems: number;
  totalItems: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const partial = readiness === "PARTIAL";
  const uncounted = totalItems - countedItems;

  return (
    <div>
      <ConfirmAction
        label="أقفل الجرد"
        title="إقفال جرد هذه الفترة"
        consequence={
          `ستُجمَّد الأرقام كما هي الآن، وتُحفظ مصادرها (نسخ الوصفات وبنود الفواتير).`
          + ` ولن يتغيّر هذا التقرير بعدها، حتى لو عدّلت وصفة أو وصلت فاتورة.`
          + (uncounted > 0 ? ` و${uncounted} صنفاً لم يُدخل لها عدّ فعلي، فستُقفل دون حساب فرقها.` : "")
          + (partial ? " والتقرير جزئي: بعض المبيعات غير محسوبة، وهذا مذكور فيه." : "")
        }
        acknowledgement="أفهم أن التقرير سيُجمَّد، وأن إعادة فتحه تحتاج إلى صلاحية المالك وسبب مكتوب."
        confirmLabel="أقفل الجرد"
        tone="warn"
        variant="primary"
        size="md"
        onConfirm={async () => {
          setError(null);
          const r = await postJson("/api/inventory/count", { action: "finalise", countId });
          if (!r.ok) {
            setError(r.error);
            return false;
          }
          router.refresh();
          return true;
        }}
      />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** إعادةُ الفتح — بسببٍ مكتوب يبقى في سجلّ التدقيق. */
export function ReopenCount({ countId }: { countId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reopen() {
    setBusy(true);
    setError(null);
    const r = await postJson("/api/inventory/count", { action: "reopen", countId, reason });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-warn/25 bg-warn-bg p-4">
      <p className="flex items-center gap-2 text-[13px] font-bold text-warn">
        <T s="{0}إعادة فتح هذا الجرد" a={[<TriangleAlert key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        سيُعاد حساب التقرير بأحدث البيانات، وقد تتغيّر أرقامه. يبقى السبب في سجل التدقيق، ويظهر في التقرير عدد مرات إعادة الفتح.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="سبب إعادة فتح الجرد"
          placeholder="لماذا تعيد فتحه؟"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-9"
        />
        <button
          aria-busy={busy}
          type="button" onClick={reopen}
          disabled={busy || reason.trim().length < 4}
          className={buttonClass("secondary", "sm")}
        >
          أعد فتح الجرد
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** يُعيد الحساب على أحدث البيانات — بعد استيرادٍ أو تصحيحِ وصفة. */
export function RecomputeCount({ countId }: { countId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        aria-busy={busy}
        type="button"
        className={buttonClass("secondary", "sm")}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/inventory/count", { action: "recompute", countId });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
        }}
      >
        <T s="{0}أعد الحساب" a={[<RefreshCw key="0" className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden />]} /></button>
      {error && <span role="alert" className="ms-2 text-xs text-danger">{error}</span>}
    </>
  );
}

/**
 * «ابدأ جرداً جديداً» — والجردُ المفتوحُ لم يُقفَل بعد.
 *
 * كانت شاشةُ «الجرد الحالي» تعرض المفتوحَ وحده، فمن ترك جرداً ناقصاً لا
 * يبدأ غيرَه إلّا أن يُقفله. والخدمةُ لم تمنع ذلك قطّ: تمنع **تداخلَ**
 * الأسابيع وحده (`OverlappingPeriodError`). فيُبدأ الجديد لأسبوعٍ آخر،
 * ويبقى السابقُ مسوّدةً كما هو يُعاد إليه من «جرودٌ مفتوحة».
 */
export function NewCount({
  defaultStart,
  defaultEnd,
  branches,
  openWeek,
  openCountId,
  openBranchId,
}: {
  defaultStart: string;
  defaultEnd: string;
  branches: { id: string; name: string }[];
  /** أسبوعُ الجرد المفتوح — يُذكَر كي لا يُظنّ أنّه يُحذَف. */
  openWeek: { start: string; end: string };
  openCountId: string;
  /** فرعُ المفتوح — الجديدُ لأسبوعه يُبدأ للفرع نفسه. */
  openBranchId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  /* يُلغى المفتوحُ ثمّ يُبدأ أسبوعُه — طلبان، والثاني لا يقع إن فشل الأوّل */
  async function restart(): Promise<boolean> {
    const d = await postJson("/api/inventory/count", { action: "discard", countId: openCountId });
    if (!d.ok) {
      toast({ tone: "danger", title: "تعذّر إلغاء الجرد", body: d.error });
      return false;
    }
    const r = await postJson<{ countId: string }>("/api/inventory/count", {
      action: "start", periodStart: openWeek.start, periodEnd: openWeek.end, branchId: openBranchId,
    });
    if (!r.ok) {
      toast({ tone: "danger", title: "أُلغي الجرد، لكن الجرد الجديد لم يبدأ", body: `${r.error}. ابدأ الجرد الجديد من «ابدأ جرداً جديداً».` });
      router.push("/inventory");
      router.refresh();
      return false;
    }
    toast({ tone: "ok", title: "بدأ جرد جديد", body: `أسبوع ${formatWeek(openWeek.start, openWeek.end)}، فارغ.` });
    setOpen(false);
    router.push(`/inventory/counts/${r.data.countId}`);
    router.refresh();
    return true;
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        <T s="{0}ابدأ جرداً جديداً" a={[<CalendarPlus key="0" className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />]} /></button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="جرد جديد"
        description={`جرد أسبوع ${formatWeek(openWeek.start, openWeek.end)} يبقى مفتوحاً كما هو، وتعود إليه متى شئت لإكماله أو إقفاله. أما الجرد الجديد فلأسبوع آخر.`}
        size="md"
      >
        <StartCount
          defaultStart={defaultStart}
          defaultEnd={defaultEnd}
          branches={branches}
          openWeekStart={openWeek.start}
          onSameWeek={() => setOpen(false)}
          onRestart={restart}
        />
      </Sheet>
    </>
  );
}

/**
 * إلغاءُ جردٍ لم يُقفَل — ليُبدأ من جديد أو يُترك.
 * ما عُدّ فيه يُحفَظ في سجلّ التدقيق، والمقفَلُ لا يُلغى (يُعاد فتحُه).
 */
export function DiscardCount({
  countId,
  week,
  countedItems,
}: {
  countId: string;
  week: { start: string; end: string };
  countedItems: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <ConfirmAction
        label="ألغِ هذا الجرد"
        title={`إلغاء جرد أسبوع ${formatWeek(week.start, week.end)}`}
        consequence={
          "سيُحذف هذا الجرد دون إقفال، ويعود أسبوعه بلا جرد، ويمكنك بدء جرد جديد له متى شئت."
          + (countedItems > 0
            ? ` والأعداد التي أدخلتها فيه (${countNoun(countedItems, ITEM)}) لن تُنقل إلى الجرد الجديد، وتبقى في سجل التدقيق فقط.`
            : " ولم يُعدّ فيه أي صنف بعد.")
          + " أما الهدر المسجّل في الأسبوع فيبقى كما هو."
        }
        acknowledgement="أفهم أن هذا الجرد سيُحذف، وأن أعداده لن تعود إلا إن أدخلتها من جديد."
        confirmLabel="ألغِ الجرد"
        variant="quiet"
        onConfirm={async () => {
          setError(null);
          const r = await postJson<{ message?: string }>("/api/inventory/count", { action: "discard", countId });
          if (!r.ok) {
            setError(r.error);
            return false;
          }
          toast({ tone: "ok", title: "أُلغي الجرد", body: r.data.message ?? "" });
          router.push("/inventory");
          router.refresh();
          return true;
        }}
      />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
