"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyalsDisplay } from "@/lib/money";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import type { HeldRowView } from "@/services/bank-held.service";

/**
 * صفوفٌ من الكشف لم تُقيَّد لأنّ الدليل لا يحسمها — ومعها قرارُها.
 *
 * الملتبس: بلا مرجعٍ ويشبه حركةً لها مرجع — «هي نفسها» أو «حركةٌ أخرى».
 * المتضارب: المرجعُ نفسُه بمبلغٍ آخر — يُنظر في الملفّ ثمّ «تحقّقتُ»؛ لا يُضاف.
 * وكانا يُعدّان في نتيجة الاستيراد ثمّ يختفيان.
 */
export function BankHeldRows({ rows, canEdit }: { rows: HeldRowView[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  async function decide(id: string, decision: "SAME" | "ADDED" | "CHECKED" | "REMOVED") {
    setBusy(id);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/bank-held", { id, decision });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُسم" });
    router.refresh();
  }

  return (
    <div className="mb-3 rounded-xl border border-warn/25 bg-warn-bg px-4 py-3">
      <p className="flex items-center gap-2 text-[13px] font-bold">
        <CircleHelp className="h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={2} aria-hidden />
        {rows.length === 1 ? "حركةٌ تنتظر قرارك — الدليلُ لا يحسمها" : `${rows.length} حركاتٍ تنتظر قرارك — الدليلُ لا يحسمها`}
      </p>
      <ul className="mt-2 divide-y divide-line-soft">
        {rows.map((r) => (
          <li key={r.id} className="py-2.5 text-xs leading-relaxed">
            <p>
              <span className="font-bold">{r.direction === "DEBIT" ? "صادر" : "وارد"} {formatRiyalsDisplay(r.amountMinor)}</span>
              <span className="text-muted"> · <bdi className="nums">{r.day}</bdi> · {r.description ?? "بلا وصف"}</span>
            </p>
            <p className="mt-0.5 text-ink-soft">
              {r.kind === "CONFLICT" && <TriangleAlert className="me-1 inline h-3.5 w-3.5 text-danger" aria-hidden />}
              {r.reason}
              {r.against && r.kind === "MISSING_FROM_FILE" && (
                <>
                  {" — "}
                  <Link href={`/bank/tx/${r.against.id}`} className="font-bold text-accent hover:underline">افتح الحركة</Link>
                </>
              )}
              {r.against && r.kind !== "MISSING_FROM_FILE" && (
                <>
                  {" — تشبه "}
                  <Link href={`/bank/tx/${r.against.id}`} className="font-bold text-accent hover:underline">
                    حركةَ <bdi className="nums">{r.against.day}</bdi> بـ{formatRiyalsDisplay(r.against.amountMinor)}
                    {r.against.operationRef ? <> (مرجع <bdi className="nums">{r.against.operationRef}</bdi>)</> : null}
                  </Link>
                </>
              )}
            </p>
            {canEdit && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {r.kind === "MISSING_FROM_FILE" ? (
                  <>
                    <button type="button" disabled={busy !== null} onClick={() => decide(r.id, "REMOVED")} className={buttonClass("danger", "sm")}>
                      ليست في الكشف — احذفها
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => decide(r.id, "CHECKED")} className={buttonClass("secondary", "sm")}>
                      أبقِها
                    </button>
                  </>
                ) : r.kind === "AMBIGUOUS" ? (
                  <>
                    <button type="button" disabled={busy !== null} onClick={() => decide(r.id, "SAME")} className={buttonClass("secondary", "sm")}>
                      هي نفسها
                    </button>
                    <button type="button" disabled={busy !== null} onClick={() => decide(r.id, "ADDED")} className={buttonClass("primary", "sm")}>
                      حركةٌ أخرى — أضِفها
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => decide(r.id, "CHECKED")} className={buttonClass("secondary", "sm")}>
                    نظرتُ في الملفّ — أغلِقه
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
