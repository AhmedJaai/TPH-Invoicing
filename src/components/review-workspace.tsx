"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Money } from "./money";
import { Badge, buttonClass, Card, EmptyState } from "./ui";
import {
  BUCKET_HINT, BUCKET_LABEL, bulkConfirmable, groupForReview,
  type ReviewBucket, type ReviewItem,
} from "@/lib/bank/review-queue";

/**
 * طابور المراجعة الموحَّد.
 *
 * كان ما ينتظر قرار الإنسان مبعثراً: بعضُه في «البنك»، وبعضُه في «ما
 * يحتاج انتباهك»، وبعضُه لا يظهر إلّا في نتيجة الاستيراد فيضيع بإغلاق
 * الشاشة. فلا يعرف صاحب العمل كم بقي عليه، ولا يرى عملَه ينقص.
 *
 * وهنا **ثلاثة أعمالٍ مفصولة** لأنّها تحتاج ثلاثة أنواعٍ من الانتباه:
 * ما يُختَم في ثوانٍ، وما يحتاج عيناً، وما يحتاج تعريفاً. وخلطُها في
 * عددٍ واحد — «١٢٧ تحتاج مراجعة» — يُرهب ولا يُرشد.
 */

export interface ReviewWorkspaceProps {
  items: ReviewItem[];
  /** هل يملك المستخدم صلاحية الإقرار؟ */
  canApprove: boolean;
}

const BUCKET_TONE: Record<ReviewBucket, string> = {
  CONFIRM: "border-ok/40 bg-ok-bg",
  REVIEW: "border-warn/40 bg-warn-bg",
  RESOLVE: "border-line bg-raised",
};

export function ReviewWorkspace({ items, canApprove }: ReviewWorkspaceProps) {
  const router = useRouter();
  const groups = useMemo(() => groupForReview(items), [items]);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    rejected?: { transactionId: string; reason: string }[];
  } | null>(null);

  const confirmable = useMemo(() => bulkConfirmable(items), [items]);

  async function confirmAll() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/match-confirm-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
          تُرسَل المعرّفات وحدها — لا فواتير ولا مبالغ ولا مورّد.
          الخادم يُعيد الحساب على الفواتير كما هي الآن، لأنّ الاقتراح
          حُسب لحظةَ الاستيراد وقد تكون فاتورته سُدّدت بعده.
        */
        body: JSON.stringify({ transactionIds: confirmable.slice(0, 50) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "تعذّر الإقرار" });
        return;
      }

      setResult({
        ok: true,
        message: data.message,
        rejected: (data.outcomes ?? [])
          .filter((o: { ok: boolean }) => !o.ok)
          .map((o: { transactionId: string; reason: string }) => ({
            transactionId: o.transactionId,
            reason: o.reason,
          })),
      });
      router.refresh();
    } catch {
      setResult({ ok: false, message: "تعذّر الاتصال" });
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="لا شيء ينتظرك"
        hint="كل حركة في الكشف لها قرارٌ مسجَّل — إمّا مطابَقة وإمّا معلَنٌ أنّها ليست سداداً."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/*
        الخلاصة تُقرأ في ثانية: «يُقَرّ ٣٠١ · يُراجَع ١٧ · يُحسَم ٩».
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map((g) => (
          <div
            key={g.bucket}
            className={`rounded-2xl border px-4 py-3 shadow-raised ${BUCKET_TONE[g.bucket]}`}
          >
            <p className="text-xs font-bold">{BUCKET_LABEL[g.bucket]}</p>
            <p className="nums mt-1 font-display text-3xl font-bold leading-none">
              {g.items.length}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
              {BUCKET_HINT[g.bucket]}
            </p>
            {g.amountMinor > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                <Money minor={g.amountMinor} />
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ── يُقَرّ: ختمٌ جماعيّ ── */}
      {confirmable.length > 0 && canApprove && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">
                {confirmable.length} اقتراحاً جاهزاً للختم
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                يُعاد حسابها في الخادم قبل الكتابة — على الفواتير كما هي الآن، لا كما
                كانت لحظة الاستيراد. وما تغيّر حاله يُعاد إليك بسببه ولا يُقَرّ.
                {confirmable.length > 50 && " ويُقَرّ خمسون في المرّة."}
              </p>
            </div>
            <button
              type="button"
              className={buttonClass("primary")}
              disabled={busy}
              onClick={confirmAll}
            >
              {busy ? "يُعاد الحساب…" : `أقِرّ ${Math.min(50, confirmable.length)}`}
            </button>
          </div>

          {result && (
            <div
              className={`mt-3 rounded-xl border px-3 py-2.5 ${
                result.ok ? "border-ok/40 bg-ok-bg" : "border-bad/40 bg-bad-bg"
              }`}
            >
              <p className="text-xs font-bold">{result.message}</p>
              {result.rejected && result.rejected.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {result.rejected.slice(0, 6).map((r) => (
                    <li key={r.transactionId} className="text-[11px] leading-relaxed text-ink-soft">
                      {r.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── القوائم ── */}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.bucket}>
            <h2 className="mb-2 text-sm font-bold">
              {BUCKET_LABEL[g.bucket]}{" "}
              <span className="nums text-muted">({g.items.length})</span>
            </h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
              {g.items.slice(0, 40).map((i) => (
                <li key={i.transactionId} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {i.supplierName ?? "جهة غير معروفة"}
                    </span>
                    <span className="nums text-sm font-bold">
                      <Money minor={i.amountMinor} />
                    </span>
                  </div>
                  <p className="nums mt-0.5 text-[11px] text-muted" dir="ltr">
                    {i.valueDate} · {i.description.slice(0, 80)}
                  </p>
                  {i.reasons.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {i.reasons.slice(0, 3).map((why, n) => (
                        <li key={n} className="text-[11px] leading-relaxed text-ink-soft">
                          — {why}
                        </li>
                      ))}
                    </ul>
                  )}
                  {i.score !== null && (
                    <Badge tone={i.score >= 85 ? "ok" : "warn"}>
                      <span className="nums">{i.score}٪</span>
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
            {g.items.length > 40 && (
              <p className="mt-1.5 text-[11px] text-muted">
                وأخرى — <span className="nums">{g.items.length - 40}</span>. والمعروض
                أكبرها مبلغاً، لأنّ خطأه أغلى.
              </p>
            )}
          </section>
        ))}
    </div>
  );
}
