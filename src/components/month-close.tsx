"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, CircleAlert, CircleCheck, Download, FileSpreadsheet, Landmark, Lock, Receipt, RotateCw, ShieldCheck,
  TriangleAlert, Unlock, Wallet, type LucideIcon,
} from "lucide-react";
import type { CheckItem, MonthCloseReport } from "@/lib/month-close";
import { ConfirmAction, toast } from "./ui-client";
import { countNoun, BLOCKER, CHECK, WARNING } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";

interface Response {
  report: MonthCloseReport;
  status: "OPEN" | "IN_REVIEW" | "CLOSED";
  message?: string;
  error?: string;
}

/**
 * الإقفالُ قائمةٌ موجَّهة لا قائمةُ بنود.
 *
 * الفحوصُ نفسُها (`lib/month-close.ts`) مجموعةً في أربع خطوات بترتيب ما
 * يعتمد عليه ما بعدها: المستندات ← الضريبة ← السداد والكشوف ← البنك، ثمّ
 * الإقفال، ثمّ حزمةُ المحاسب. ولكلّ خطوةٍ حالُها (أسوأُ ما فيها)، ولكلّ
 * بندٍ لم يجتز موضعُ إصلاحه. والقائمةُ تُرسَم ممّا حسبه الخادم، وتغييرُ
 * الشهر وحده يستدعيه.
 */

type State = CheckItem["state"];

const STEPS: { id: string; title: string; icon: LucideIcon; ids: readonly string[] }[] = [
  { id: "documents", title: "المستندات", icon: Receipt, ids: ["has-invoices", "no-pending-review", "no-blockers"] },
  { id: "tax", title: "الضريبة", icon: ShieldCheck, ids: ["tax-unknown", "tax-valid", "fixed-assets"] },
  { id: "payables", title: "السداد والكشوف", icon: Wallet, ids: ["paid", "statements"] },
  { id: "bank", title: "البنك", icon: Landmark, ids: ["bank", "bank-coverage", "bank-balance", "bank-unexplained"] },
];

const RANK: Record<State, number> = { PASS: 0, WARN: 1, BLOCK: 2 };

const STATE_UI: Record<State, { icon: LucideIcon; text: string; chip: string; label: string }> = {
  PASS: { icon: CircleCheck, text: "text-ok", chip: "bg-ok-bg text-ok", label: "سليم" },
  WARN: { icon: TriangleAlert, text: "text-warn", chip: "bg-warn-bg text-warn", label: "تنبيه لا يمنع" },
  BLOCK: { icon: CircleAlert, text: "text-danger", chip: "bg-danger-bg text-danger", label: "يمنع الإقفال" },
};

function worst(items: readonly CheckItem[]): State {
  return items.reduce<State>((w, i) => (RANK[i.state] > RANK[w] ? i.state : w), "PASS");
}

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
        if (action === "close") toast({ tone: "ok", title: `أُقفل ${formatMonth(forMonth)}`, body: "والحزمةُ جاهزةٌ للمحاسب أدناه." });
        if (action === "reopen") toast({ tone: "warn", title: `فُتح ${formatMonth(forMonth)} من جديد`, body: "سُجّل الفتح في سجلّ التدقيق باسمك." });
        if (action === "balances") toast({ tone: "ok", title: "حُفظ الرصيدان وأُعيد الفحص" });
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
  const passed = report?.items.filter((i) => i.state === "PASS").length ?? 0;
  const total = report?.items.length ?? 0;
  const byId = new Map(report?.items.map((i) => [i.id, i]) ?? []);
  const grouped = STEPS.map((s) => ({ ...s, items: s.ids.map((id) => byId.get(id)).filter((i): i is CheckItem => !!i) }))
    .filter((s) => s.items.length > 0);
  const known = new Set(STEPS.flatMap((s) => s.ids));
  const other = report?.items.filter((i) => !known.has(i.id)) ?? [];
  if (other.length > 0) grouped.push({ id: "other", title: "أخرى", icon: CircleAlert, ids: [], items: other });

  return (
    <div className="space-y-8">
      {/* ── الشهر ── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          الشهر
          <select
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              void call("check", e.target.value);
            }}
            className="min-h-11 rounded-lg border border-line-input bg-raised px-3 text-sm font-bold text-ink sm:min-h-9"
          >
            {months.map((m) => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </select>
        </label>
        <button onClick={() => void call("check", month)} disabled={busy !== null} className={buttonClass("secondary", "sm")}>
          <RotateCw className={`h-3.5 w-3.5 ${busy === "checking" ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden />
          {busy === "checking" ? "يفحص…" : "أعد الفحص"}
        </button>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-xs font-bold text-danger">
          <CircleAlert className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden /> {error}
        </p>
      )}

      {report && (
        <>
          {/* ── الجواب قبل القائمة ── */}
          <section
            aria-live="polite"
            className={`overflow-hidden rounded-2xl border shadow-raised ${
              isClosed ? "border-ok/25 bg-ok-bg" : report.canClose ? "border-accent-line bg-accent-soft" : "border-line bg-raised"
            }`}
          >
            <div className="flex flex-wrap items-center gap-5 p-5 sm:p-6">
              <span
                className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${
                  isClosed ? "bg-ok text-raised" : report.canClose ? "bg-accent text-accent-ink" : "bg-danger-bg text-danger"
                }`}
              >
                {isClosed ? <Lock className="h-7 w-7" strokeWidth={1.75} aria-hidden /> : report.canClose ? <CircleCheck className="h-7 w-7" strokeWidth={1.75} aria-hidden /> : <CircleAlert className="h-7 w-7" strokeWidth={1.75} aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-muted">إقفال {formatMonth(month)}</p>
                <p className="mt-1 text-2xl font-extrabold tracking-tight">
                  {isClosed ? "الشهرُ مُقفَل" : report.canClose ? "جاهزٌ للإقفال" : "لا يُقفَل بعد"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  اجتاز <span className="nums font-bold">{passed}</span> من {countNoun(total, CHECK)}
                  {report.blockers.length > 0 && <> · {countNoun(report.blockers.length, BLOCKER)} يجب حلّه</>}
                  {report.warnings.length > 0 && <> · {countNoun(report.warnings.length, WARNING)} لا يمنع</>}
                </p>
              </div>
            </div>
            <div className="flex gap-1 px-5 pb-5 sm:px-6" aria-hidden>
              {report.items.map((i) => (
                <span key={i.id} className={`h-1.5 flex-1 rounded-full ${i.state === "PASS" ? "bg-ok" : i.state === "WARN" ? "bg-warn" : "bg-danger"}`} />
              ))}
            </div>
          </section>

          {/* ── الخطوات ── */}
          <ol className="space-y-3">
            {grouped.map((s, n) => {
              const st = worst(s.items);
              const ui = STATE_UI[st];
              return (
                <li key={s.id} className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                  <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 sm:px-5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
                      <s.icon className="h-4 w-4" strokeWidth={2} aria-hidden />
                    </span>
                    <h3 className="min-w-0 flex-1 text-[15px] font-bold">
                      <span className="nums text-muted">{n + 1}.</span> {s.title}
                    </h3>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${ui.chip}`}>
                      <ui.icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      {ui.label}
                    </span>
                  </div>
                  <ul className="divide-y divide-line-soft">
                    {s.items.map((i) => {
                      const iu = STATE_UI[i.state];
                      return (
                        <li key={i.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                          <iu.icon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${iu.text}`} strokeWidth={2} aria-label={iu.label} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-bold leading-snug">{i.label}</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{i.detail}</p>
                            {i.action && i.state !== "PASS" && (
                              <p className="mt-1 text-xs leading-relaxed text-muted">
                                <span className="font-bold text-ink-soft">الخطوة التالية: </span>{i.action}
                              </p>
                            )}
                          </div>
                          {i.href && i.state !== "PASS" && (
                            <Link href={i.href} className={buttonClass(i.state === "BLOCK" ? "primary" : "secondary", "sm")}>
                              أصلِح <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ol>

          {/* ── رصيدا الشهر: بهما وحدهما تُفحَص المعادلة ── */}
          {!isClosed && report.items.some((i) => i.id === "bank-balance" && i.state !== "PASS") && (
            <form
              id="balances"
              className="scroll-mt-28 rounded-xl border border-line bg-raised p-5 shadow-raised"
              onSubmit={(e) => {
                e.preventDefault();
                void call("balances", month, { openingBalance: opening, closingBalance: closing });
              }}
            >
              <h3 className="text-[15px] font-bold">رصيدا الحساب في {formatMonth(month)}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                كما في كشف البنك: الرصيد قبل أوّل حركةٍ في الشهر، والرصيد بعد آخرها. بهما تُفحَص
                المعادلة: الافتتاحيّ + الوارد − الصادر = الختاميّ.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="font-bold text-ink-soft">الرصيد الافتتاحيّ</span>
                  <input
                    value={opening}
                    onChange={(e) => setOpening(e.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    required
                    placeholder="0.00"
                    className="nums mt-1.5 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  <span className="font-bold text-ink-soft">الرصيد الختاميّ</span>
                  <input
                    value={closing}
                    onChange={(e) => setClosing(e.target.value)}
                    inputMode="decimal"
                    dir="ltr"
                    required
                    placeholder="0.00"
                    className="nums mt-1.5 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy !== null || !opening.trim() || !closing.trim()}
                className={`${buttonClass("primary", "sm")} mt-4`}
              >
                {busy === "balancing" ? "يحفظ…" : "احفظ الرصيدين وأعد الفحص"}
              </button>
            </form>
          )}

          {/* ── الإقفال ── */}
          {!isClosed ? (
            <section className="rounded-xl border border-line bg-raised p-5 shadow-raised">
              <h3 className="flex items-center gap-2 text-[15px] font-bold">
                <Lock className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
                <span className="nums text-muted">{grouped.length + 1}.</span> الإقفال
              </h3>
              {report.canClose ? (
                <>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                    {report.warnings.length === 0
                      ? "لا شيء يمنع الإقفال ولا شيء ينبّه. "
                      : `لا مانع، وفيه ${countNoun(report.warnings.length, WARNING)} ستُقَرّ بها. `}
                    بعد الإقفال ترفض الأرشفةُ إضافة أيّ مستندٍ إلى هذا الشهر، وتستطيع إعادة فتحه متى وصلت فاتورةٌ متأخّرة.
                  </p>
                  {report.warnings.length > 0 && (
                    <label className="mt-3 block text-xs">
                      <span className="font-bold text-ink-soft">سبب الإقفال مع التنبيهات</span>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="يُحفظ في سجلّ التدقيق"
                        dir="auto"
                        className="mt-1.5 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
                      />
                    </label>
                  )}
                  <div className="mt-4">
                    <ConfirmAction
                      label={busy === "closing" ? "يُقفل…" : `أقفل ${formatMonth(month)}`}
                      variant="primary"
                      tone="warn"
                      size="md"
                      block
                      disabled={busy !== null}
                      title={`إقفال ${formatMonth(month)}`}
                      consequence={
                        report.warnings.length > 0
                          ? `بعد الإقفال ترفض الأرشفة أيّ مستند لهذا الشهر، وتُقَرّ ${countNoun(report.warnings.length, WARNING)} على حالها. وتستطيع إعادة فتحه متى وصلتك فاتورة متأخّرة.`
                          : "بعد الإقفال ترفض الأرشفة أيّ مستند لهذا الشهر. وتستطيع إعادة فتحه متى وصلتك فاتورة متأخّرة."
                      }
                      acknowledgement={`أُقرّ بأنّ فواتير ${formatMonth(month)} كلّها وصلت، وأنّ ما بقي من تنبيهات مقصودٌ لا مفوت.`}
                      confirmLabel={`أقفل ${formatMonth(month)}`}
                      onConfirm={() => call("close", month)}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  <span className="font-bold text-danger">{countNoun(report.blockers.length, BLOCKER)} يجب معالجته قبل الإقفال.</span>{" "}
                  هذه أخطاءٌ في البيانات نفسها لا وقائع تُقرّ بها — أصلحها من أزرار «أصلِح» أعلاه ثمّ أعد الفحص.
                </p>
              )}
            </section>
          ) : (
            <section className="rounded-xl border border-line bg-raised p-5 shadow-raised">
              <h3 className="flex items-center gap-2 text-[15px] font-bold">
                <Lock className="h-4 w-4 text-ok" strokeWidth={2} aria-hidden /> هذا الشهر مقفل
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                الأرشفةُ ترفض إضافة مستندٍ إليه. إن وصلتك فاتورةٌ متأخّرة تخصّه، أعد فتحه — ويُسجَّل ذلك باسمك.
              </p>
              <div className="mt-4">
                <ConfirmAction
                  label={busy === "reopening" ? "يفتح…" : "أعد فتح الشهر"}
                  variant="secondary"
                  tone="warn"
                  disabled={busy !== null}
                  title={`إعادة فتح ${formatMonth(month)}`}
                  consequence="تُقبَل إضافة المستندات إليه من جديد، ويُسجَّل الفتح في سجلّ التدقيق باسمك. وتقارير الشهر تتغيّر بما يُضاف بعده."
                  acknowledgement="أُقرّ بأنّ لديّ ما يخصّ هذا الشهر ولم يُدرَج فيه."
                  confirmLabel={`افتح ${formatMonth(month)}`}
                  onConfirm={() => call("reopen", month)}
                />
              </div>
            </section>
          )}

          {/* ── حزمة المحاسب ── */}
          <section id="export" className="scroll-mt-28 overflow-hidden rounded-xl border border-accent-line bg-raised shadow-raised">
            <div className="flex flex-wrap items-center gap-4 p-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <FileSpreadsheet className="h-6 w-6" strokeWidth={1.75} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[15px] font-bold">حزمة المحاسب — {formatMonth(month)}</h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                  ملفّ Excel بستّ أوراق: الملخّص · الفواتير · الضريبة · الدفعات · المصروفات · حركات البنك.
                  {isClosed ? " الشهرُ مقفل، فأرقامُه ثابتة." : " الشهرُ مفتوح — قد تتغيّر أرقامُه بعد التنزيل، ويُكتب ذلك في الملفّ."}
                </p>
              </div>
              <a href={`/api/export/accountant?month=${month}`} download className={buttonClass(isClosed ? "primary" : "secondary")}>
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
                نزّل الحزمة
              </a>
            </div>
          </section>

          {isClosed && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <Unlock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              إعادةُ الفتح والإقفال كلاهما في سجلّ التدقيق بالاسم والوقت.
            </p>
          )}
        </>
      )}
    </div>
  );
}
