"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { ConfirmAction } from "./ui-client";
import { CalendarRange, ChevronLeft, ChevronRight, CircleAlert, RefreshCw, Store, TriangleAlert } from "lucide-react";
import { shiftDays, weekOf, type Week } from "@/lib/inventory/week";
import { countNoun } from "@/lib/arabic";
import { WEEK, formatWeek } from "./inventory-ui";

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
}: {
  defaultStart: string;
  defaultEnd: string;
  branches: { id: string; name: string }[];
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
          <h2 id="start-count-title" className="text-base font-bold">ابدأ جردَ أسبوع</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            من الأحد إلى تقفيلة السبت. يُهيَّأ لك ما بِيع فيه وما اشتُري، ثمّ تُدخل ما وجدتَه وحده.
          </p>
        </div>
      </div>

      {/* ── الأسبوعُ يُتنقَّل بين جيرانه — لا تاريخان حرّان ── */}
      <div className="mt-5 flex items-stretch gap-2">
        <button
          type="button"
          aria-label="الأسبوع السابق"
          onClick={() => setWeek(weekOf(shiftDays(week.start, -7)))}
          className={`${buttonClass("secondary", "md")} w-11 px-0 sm:w-11`}
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2} aria-hidden />
        </button>
        <div className="min-w-0 flex-1 rounded-xl border border-line bg-sunken/60 px-4 py-2.5 text-center" aria-live="polite">
          <p className="text-[15px] font-bold leading-snug sm:text-base">{formatWeek(week.start, week.end)}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {atLatest ? "آخرُ أسبوعٍ اكتمل" : `قبل ${countNoun(Math.round((Date.parse(defaultStart) - Date.parse(week.start)) / (7 * 86_400_000)), WEEK)}`}
          </p>
        </div>
        <button
          type="button"
          aria-label="الأسبوع التالي"
          disabled={atLatest}
          onClick={() => setWeek(weekOf(shiftDays(week.start, 7)))}
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

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={begin}
          disabled={busy}
          className={`${buttonClass(prerequisite ? "secondary" : "primary", "lg")} w-full sm:w-auto`}
        >
          {busy ? "يُهيَّأ الجرد…" : "ابدأ جردَ هذا الأسبوع"}
        </button>
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
        label="أقفِل الجرد"
        title="إقفالُ جرد هذه الفترة"
        consequence={
          `تُجمَّد الأرقام كما هي الآن، وتُحفَظ أصولُها (نسخُ الوصفات وأسطرُ الفواتير).`
          + ` ولا يتغيّر هذا التقرير بعدها مهما عُدّلت وصفةٌ أو وصلت فاتورة.`
          + (uncounted > 0 ? ` و${uncounted} صنفاً لم يُدخَل له عدٌّ فعليّ — يُقفَل بلا فرقٍ محسوب.` : "")
          + (partial ? " والتقريرُ جزئيّ: بعضُ المبيعات خارج الحساب، وهو مكتوبٌ في التقرير." : "")
        }
        acknowledgement="أفهم أنّ التقرير يُجمَّد، وأنّ إعادة فتحه تحتاج صلاحيةَ المالك وسبباً مكتوباً."
        confirmLabel="أقفِله"
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
        <TriangleAlert className="h-4 w-4" strokeWidth={2} aria-hidden />
        إعادةُ فتح هذا الجرد
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        يُعاد حسابُ التقرير على أحدث البيانات، فقد تتغيّر أرقامُه. والسببُ يبقى في سجلّ
        التدقيق، وعدّادُ الفتح يُعرَض في التقرير.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="سبب إعادة فتح الجرد"
          placeholder="لماذا يُعاد فتحُه؟"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-9"
        />
        <button
          aria-busy={busy}
          type="button" onClick={reopen}
          disabled={busy || reason.trim().length < 4}
          className={buttonClass("secondary", "sm")}
        >
          أعِد فتحه
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
        <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden />
        أعِد الحساب
      </button>
      {error && <span role="alert" className="ms-2 text-xs text-danger">{error}</span>}
    </>
  );
}
