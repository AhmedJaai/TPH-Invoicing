"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckItem, MonthCloseReport } from "@/lib/month-close";
import { ConfirmAction } from "./ui-client";
import { countNoun, BLOCKER, CHECK, WARNING } from "@/lib/arabic";
import { postJson } from "@/lib/http-client";

interface Response {
  report: MonthCloseReport;
  status: "OPEN" | "IN_REVIEW" | "CLOSED";
  message?: string;
  error?: string;
}

function ChecksSummary({
  items,
  canClose,
  month,
}: {
  items: readonly { state: "PASS" | "WARN" | "BLOCK" }[];
  canClose: boolean;
  month: string;
}) {
  const passed = items.filter((i) => i.state === "PASS").length;
  const blocks = items.filter((i) => i.state === "BLOCK").length;
  const warns = items.filter((i) => i.state === "WARN").length;

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <p className="text-xs text-muted">إقفال {month}</p>
      <p className="mt-1.5 font-display text-2xl font-bold leading-none">
        {canClose ? "جاهز للإقفال" : "لا يمكن الإقفال بعد"}
      </p>
      <p className="mt-2.5 text-sm font-bold">
        اجتاز <span className="nums">{passed}</span> من {countNoun(items.length, CHECK)}
      </p>

      <div className="mt-3 flex gap-1" aria-hidden>
        {items.map((i, n) => (
          <span
            key={n}
            className={`h-1.5 flex-1 rounded-full ${
              i.state === "PASS" ? "bg-ok" : i.state === "WARN" ? "bg-warn" : "bg-danger"
            }`}
          />
        ))}
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-muted">
        {blocks > 0
          ? `${countNoun(blocks, BLOCKER)} يجب حلّه، و${countNoun(warns, WARNING)} لا يمنع.`
          : warns > 0
            ? `لا مانع. و${countNoun(warns, WARNING)} ستُقَرّ بها عند الإقفال.`
            : "لا مانع ولا تنبيه."}
      </p>
    </div>
  );
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
  const [busy, setBusy] = useState<"checking" | "closing" | "reopening" | "balancing" | null>(null);
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const call = useCallback(
    async (action: "check" | "close" | "reopen" | "balances", forMonth: string, extra?: Record<string, string>) => {
      setBusy(action === "check" ? "checking" : action === "close" ? "closing" : action === "balances" ? "balancing" : "reopening");
      setError(null);
      try {
        const r = await postJson<Response>("/api/month-close", {
          month: forMonth, action, note: note.trim() || undefined, ...extra,
        });
        if (!r.ok) {
          setError(r.error);
          if (r.data.report && r.data.status) setData(r.data as Response);
          return false;
        }
        setData(r.data);
        if (action !== "check") router.refresh();
        return true;
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
          aria-label="الشهر"
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
          {/*
            رأسٌ يجيب السؤال قبل القائمة.
            قائمةٌ من ثمانية بنود لا تقول «هل أقفل أم لا» إلّا بعد قراءتها
            كلّها. والعدد يقولها في سطر، ثمّ تُقرأ التفاصيل عند الحاجة.
          */}
          <ChecksSummary items={report.items} canClose={report.canClose} month={month} />

          <ul className="space-y-2">
            {report.items.map((i) => {
              const st = STATE_STYLE[i.state];
              return (
                <li key={i.id} className={`rounded-2xl border p-3.5 shadow-raised sm:p-4 ${st.box}`}>
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
                      {i.href && i.state !== "PASS" && (
                        <a
                          href={i.href}
                          className="mt-1 inline-flex min-h-11 items-center text-xs font-bold underline underline-offset-4 sm:min-h-0"
                        >
                          أصلِح ←
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {!isClosed && report.items.some((i) => i.id === "bank-balance" && i.state !== "PASS") && (
            <form
              id="balances"
              className="scroll-mt-28 rounded-2xl border border-line bg-raised p-4 shadow-raised"
              onSubmit={(e) => {
                e.preventDefault();
                void call("balances", month, { openingBalance: opening, closingBalance: closing });
              }}
            >
              <p className="text-sm font-bold">رصيدا الحساب في {month}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                كما في كشف البنك: الرصيد قبل أوّل حركةٍ في الشهر، والرصيد بعد آخرها. بهما تُفحَص
                المعادلة: الافتتاحيّ + الوارد − الصادر = الختاميّ.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="text-muted">الرصيد الافتتاحيّ</span>
                  <input
                    value={opening}
                    onChange={(e) => setOpening(e.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    required
                    className="nums mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                </label>
                <label className="block text-xs">
                  <span className="text-muted">الرصيد الختاميّ</span>
                  <input
                    value={closing}
                    onChange={(e) => setClosing(e.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    required
                    className="nums mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy !== null || !opening.trim() || !closing.trim()}
                className="mt-3 min-h-11 rounded-lg bg-inverse-surface px-4 text-xs font-bold text-inverse-ink disabled:opacity-40"
              >
                {busy === "balancing" ? "يحفظ…" : "احفظ الرصيدين وأعد الفحص"}
              </button>
            </form>
          )}

          {!isClosed && (
            <div className="rounded-2xl border border-line bg-raised shadow-raised p-4">
              {report.canClose ? (
                <>
                  <p className="text-sm font-bold">
                    {report.warnings.length === 0
                      ? "لا شيء يمنع الإقفال ولا شيء ينبّه."
                      : `لا مانع من الإقفال، وفيه ${countNoun(report.warnings.length, WARNING)} ستُقَرّ بها.`}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    بعد الإقفال ترفض الأرشفة إضافة أي مستند إلى هذا الشهر. ويمكنك إعادة فتحه
                    متى وجدت فاتورة متأخّرة.
                  </p>
                  {report.warnings.length > 0 && (
                    /* النصّ المؤقّت ليس اسماً: يختفي عند أوّل حرفٍ يُكتب، فيبقى
                       أخطرُ حقلٍ في الشهر بلا ما يقول ما هو */
                    <label className="mt-3 block text-xs">
                      <span className="text-muted">سبب الإقفال مع التنبيهات</span>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="يُحفظ في سجلّ التدقيق"
                        dir="auto"
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs outline-none focus:border-ink"
                      />
                    </label>
                  )}
                  {/*
                    كان أخطرُ فعلٍ شهريّ يقع في نافذة المتصفّح الأصليّة،
                    وأزرارها «OK» و«Cancel» بلغة النظام لا بلغة الفعل.
                    وهذا اللوح يسمّي ما سيقع ويطلب إقراراً به.
                  */}
                  <div className="mt-3">
                    <ConfirmAction
                      label={busy === "closing" ? "يُقفل…" : `أقفل ${month}`}
                      variant="primary"
                      tone="warn"
                      size="md"
                      block
                      disabled={busy !== null}
                      title={`إقفال ${month}`}
                      consequence={
                        report.warnings.length > 0
                          ? `بعد الإقفال ترفض الأرشفة أيّ مستند لهذا الشهر، وتُقَرّ ${countNoun(report.warnings.length, WARNING)} على حالها. وتستطيع إعادة فتحه متى وصلتك فاتورة متأخّرة.`
                          : "بعد الإقفال ترفض الأرشفة أيّ مستند لهذا الشهر. وتستطيع إعادة فتحه متى وصلتك فاتورة متأخّرة."
                      }
                      acknowledgement={`أُقرّ بأنّ فواتير ${month} كلّها وصلت، وأنّ ما بقي من تنبيهات مقصودٌ لا مفوت.`}
                      confirmLabel={`أقفل ${month}`}
                      onConfirm={() => call("close", month)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-danger">
                    {countNoun(report.blockers.length, BLOCKER)} يجب معالجته قبل الإقفال
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                    هذه أخطاء في البيانات نفسها، لا وقائع تُقرّ بها. عالجها ثم أعد الفحص.
                  </p>
                </>
              )}
            </div>
          )}

          {isClosed && (
            <div className="rounded-2xl border border-line bg-raised shadow-raised p-4">
              <p className="text-sm font-bold">هذا الشهر مقفل.</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                الأرشفة ترفض إضافة مستند إليه. إن وصلتك فاتورة متأخّرة تخصّه، أعد فتحه —
                ويُسجَّل ذلك في سجل التدقيق باسمك.
              </p>
              <div className="mt-3">
                <ConfirmAction
                  label={busy === "reopening" ? "يفتح…" : "أعد فتح الشهر"}
                  variant="secondary"
                  tone="warn"
                  disabled={busy !== null}
                  title={`إعادة فتح ${month}`}
                  consequence="تُقبَل إضافة المستندات إليه من جديد، ويُسجَّل الفتح في سجلّ التدقيق باسمك. وتقارير الشهر تتغيّر بما يُضاف بعده."
                  acknowledgement="أُقرّ بأنّ لديّ ما يخصّ هذا الشهر ولم يُدرَج فيه."
                  confirmLabel={`افتح ${month}`}
                  onConfirm={() => call("reopen", month)}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
