"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { ConfirmAction } from "./ui-client";

/** يبدأ جرداً لفترةٍ يختارها صاحبُ العمل. */
export function StartCount({
  defaultStart,
  defaultEnd,
  branches,
}: {
  defaultStart: string;
  defaultEnd: string;
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ countId: string }>("/api/inventory/count", {
      action: "start",
      periodStart: start,
      periodEnd: end,
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
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <h3 className="font-display text-base font-bold">ابدأ جرداً جديداً</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        اختر الفترة، ويُهيَّأ لك ما بِيع فيها وما اشتُريت. ثمّ تُدخل العدّ الفعليّ وحده.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="block text-[11px] text-muted">من</span>
          <input
            type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="nums mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-muted">إلى</span>
          <input
            type="date" value={end} onChange={(e) => setEnd(e.target.value)}
            className="nums mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
          />
        </label>
        {branches.length > 0 && (
          <label className="block">
            <span className="block text-[11px] text-muted">الفرع</span>
            <select
              value={branchId} onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
            >
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={begin} disabled={busy || !start || !end} className={buttonClass("primary")}>
          {busy ? "يُهيَّأ…" : "ابدأ جرداً جديداً"}
        </button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
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
    <div className="rounded-2xl border border-warn/40 bg-warn-bg p-4">
      <p className="text-xs font-bold text-warn">إعادةُ فتح هذا الجرد</p>
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
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 text-sm"
        />
        <button
          type="button" onClick={reopen}
          disabled={busy || reason.trim().length < 4}
          className={buttonClass("secondary", "sm")}
        >
          {busy ? "…" : "أعِد فتحه"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
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
        {busy ? "يُحسب…" : "أعِد الحساب"}
      </button>
      {error && <span className="ms-2 text-xs text-danger">{error}</span>}
    </>
  );
}
