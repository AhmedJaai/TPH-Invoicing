"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckItem, MonthCloseReport } from "@/lib/month-close";

interface Response {
  report: MonthCloseReport;
  status: "OPEN" | "IN_REVIEW" | "CLOSED";
  message?: string;
  error?: string;
}

const STATE_STYLE: Record<CheckItem["state"], { icon: string; box: string; text: string }> = {
  PASS: { icon: "✓", box: "border-line bg-raised", text: "text-ok" },
  WARN: { icon: "!", box: "border-warn/40 bg-warn-bg", text: "text-warn" },
  BLOCK: { icon: "✕", box: "border-danger/40 bg-danger-bg", text: "text-danger" },
};

/**
 * القائمة تُرسم من بيانات حسبها الخادم، فلا شاشة فارغة تنتظر طلباً.
 * وتغيير الشهر وحده هو ما يستدعي الخادم.
 */
export function MonthClose({
  months,
  initialMonth,
  initialReport,
  initialStatus,
}: {
  months: string[];
  initialMonth: string;
  initialReport: MonthCloseReport;
  initialStatus: "OPEN" | "IN_REVIEW" | "CLOSED";
}) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<Response | null>({ report: initialReport, status: initialStatus });
  const [busy, setBusy] = useState<"checking" | "closing" | "reopening" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const call = useCallback(
    async (action: "check" | "close" | "reopen", forMonth: string) => {
      setBusy(action === "check" ? "checking" : action === "close" ? "closing" : "reopening");
      setError(null);
      try {
        const res = await fetch("/api/month-close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ month: forMonth, action, note: note.trim() || undefined }),
        });
        const json = (await res.json()) as Response;
        if (!res.ok) {
          setError(json.error ?? "تعذّر التنفيذ");
          if (json.report) setData(json);
          return;
        }
        setData(json);
        if (action !== "check") router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [note, router],
  );

  const report = data?.report;
  const isClosed = data?.status === "CLOSED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            void call("check", e.target.value);
          }}
          className="nums rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
          dir="ltr"
        >
          {months.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button
          onClick={() => void call("check", month)}
          disabled={busy !== null}
          className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-ink-soft disabled:opacity-40"
        >
          {busy === "checking" ? "يفحص…" : "أعد الفحص"}
        </button>
        {isClosed && (
          <span className="rounded-full bg-ok-bg px-3 py-1 text-[11px] font-bold text-ok">مقفل</span>
        )}
      </div>

      {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}
      {data?.message && !error && (
        <p className="rounded-lg bg-ok-bg px-3 py-2 text-xs font-bold text-ok">✓ {data.message}</p>
      )}

      {busy === "checking" && <p className="text-xs text-muted">يفحص الشهر…</p>}

      {report && (
        <>
          <ul className="space-y-2">
            {report.items.map((i) => {
              const st = STATE_STYLE[i.state];
              return (
                <li key={i.id} className={`rounded-xl border p-3.5 ${st.box}`}>
                  <div className="flex items-start gap-2.5">
                    <span className={`shrink-0 text-sm font-bold ${st.text}`}>{st.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-snug">{i.label}</p>
                      <p className="mt-0.5 text-xs text-ink-soft">{i.detail}</p>
                      {i.action && (
                        <p className="mt-1.5 text-xs leading-relaxed">
                          <span className="font-bold">الخطوة التالية: </span>
                          {i.action}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {!isClosed && (
            <div className="rounded-xl border border-line bg-raised p-4">
              {report.canClose ? (
                <>
                  <p className="text-sm font-bold">
                    {report.warnings.length === 0
                      ? "لا شيء يمنع الإقفال ولا شيء ينبّه."
                      : `لا مانع من الإقفال، وفيه ${report.warnings.length} تنبيهاً ستُقرّ بها.`}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    بعد الإقفال ترفض الأرشفة إضافة أي مستند إلى هذا الشهر. ويمكنك إعادة فتحه
                    متى وجدت فاتورة متأخّرة.
                  </p>
                  {report.warnings.length > 0 && (
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="سبب الإقفال مع التنبيهات — يُحفظ في سجل التدقيق"
                      dir="auto"
                      className="mt-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-ink"
                    />
                  )}
                  <button
                    onClick={() => {
                      if (confirm(`سيُقفل ${month} ولن تُقبل إضافة مستندات إليه. متابعة؟`)) {
                        void call("close", month);
                      }
                    }}
                    disabled={busy !== null}
                    className="mt-3 w-full rounded-lg bg-inverse-surface px-4 py-2.5 text-sm font-bold text-inverse-ink disabled:opacity-40"
                  >
                    {busy === "closing" ? "يُقفل…" : `أقفل ${month}`}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-danger">
                    {report.blockers.length} مانعاً يجب معالجته قبل الإقفال
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    هذه أخطاء في البيانات نفسها، لا وقائع تُقرّ بها. عالجها ثم أعد الفحص.
                  </p>
                </>
              )}
            </div>
          )}

          {isClosed && (
            <div className="rounded-xl border border-line bg-raised p-4">
              <p className="text-sm font-bold">هذا الشهر مقفل.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                الأرشفة ترفض إضافة مستند إليه. إن وصلتك فاتورة متأخّرة تخصّه، أعد فتحه —
                ويُسجَّل ذلك في سجل التدقيق باسمك.
              </p>
              <button
                onClick={() => {
                  if (confirm(`سيُعاد فتح ${month} وتُقبل الإضافة إليه. متابعة؟`)) {
                    void call("reopen", month);
                  }
                }}
                disabled={busy !== null}
                className="mt-3 rounded-lg border border-line px-4 py-2 text-xs font-bold hover:border-ink-soft disabled:opacity-40"
              >
                {busy === "reopening" ? "يفتح…" : "أعد فتح الشهر"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
