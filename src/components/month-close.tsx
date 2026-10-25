"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ChevronDown, CircleAlert, CircleCheck, Download, Printer, FileSpreadsheet, Landmark, Lock, Receipt, RotateCw, ShieldCheck,
  TriangleAlert, Unlock, Wallet, type LucideIcon,
} from "lucide-react";
import type { CheckItem, MonthCloseReport } from "@/lib/month-close";
import { BusyStatus, ConfirmAction, toast } from "./ui-client";
import { countNoun, doesNotBlock, mustBeResolved, BLOCKER, CHECK, WARNING } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { T } from "@/components/i18n/t";

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
  { id: "documents", title: "المستندات", icon: Receipt, ids: ["month-ended", "has-invoices", "no-pending-review", "no-blockers"] },
  { id: "tax", title: "الضريبة", icon: ShieldCheck, ids: ["tax-unknown", "tax-valid", "fixed-assets", "vat-return"] },
  { id: "payables", title: "السداد والكشوف", icon: Wallet, ids: ["paid", "statements"] },
  { id: "bank", title: "البنك", icon: Landmark, ids: ["bank", "bank-coverage", "bank-balance", "bank-unexplained", "bank-supplier-unposted"] },
];

const RANK: Record<State, number> = { PASS: 0, WARN: 1, BLOCK: 2 };

const STATE_UI: Record<State, { icon: LucideIcon; text: string; chip: string; label: string }> = {
  PASS: { icon: CircleCheck, text: "text-ok", chip: "bg-ok-bg text-ok", label: "سليم" },
  WARN: { icon: TriangleAlert, text: "text-warn", chip: "bg-warn-bg text-warn", label: "تنبيه لا يمنع الإقفال" },
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
        if (action === "close") toast({ tone: "ok", title: `أُقفل ${formatMonth(forMonth)}`, body: "وحزمة المحاسب جاهزة أدناه." });
        if (action === "reopen") toast({ tone: "warn", title: `أُعيد فتح ${formatMonth(forMonth)}`, body: "سُجّلت إعادة الفتح في سجل التدقيق باسمك." });
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
  const firstBlocker = grouped.flatMap((g) => g.items).find((i) => i.state === "BLOCK");
  const other = report?.items.filter((i) => !known.has(i.id)) ?? [];
  if (other.length > 0) grouped.push({ id: "other", title: "أخرى", icon: CircleAlert, ids: [], items: other });

  return (
    <div className="space-y-8">
      {/* ── الشهر ── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          <T s="الشهر{0}" a={[<select key="0"
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
          </select>]} /></label>
        <button aria-busy={busy === "checking"} onClick={() => void call("check", month)} disabled={busy !== null} className={buttonClass("secondary", "sm")}>
          <T s="{0}أعد الفحص" a={[<RotateCw key="0" className={`h-3.5 w-3.5 ${busy === "checking" ? "animate-spin" : ""}`} strokeWidth={2} aria-hidden />]} /></button>
        <BusyStatus
          busy={busy !== null}
          text={busy === "closing" ? "يُقفل الشهر ويُعدّ حزمة المحاسب…" : busy === "reopening" ? "يعيد فتح الشهر…" : busy === "balancing" ? "يحفظ الرصيدين ويعيد الفحص…" : "يفحص الشهر…"}
        />
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
                <p className="text-xs font-bold text-muted"><T s="إقفال {0}" a={[formatMonth(month)]} /></p>
                <p className="mt-1 text-2xl font-bold tracking-tight">
                  {isClosed ? "الشهر مقفل" : report.canClose ? "جاهز للإقفال" : "غير جاهز للإقفال"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  <T s="اجتاز {0} من {1}{2}{3}" a={[<span key="0" className="nums font-bold">{passed}</span>, countNoun(total, CHECK), report.blockers.length > 0 && <> <T s=" · {0} {1}" a={[countNoun(report.blockers.length, BLOCKER), mustBeResolved(report.blockers.length)]} /></>, report.warnings.length > 0 && <> <T s=" · {0} {1} الإقفال" a={[countNoun(report.warnings.length, WARNING), doesNotBlock(report.warnings.length)]} /></>]} /></p>
              </div>
              {/* الجوابُ ومعه الخطوةُ التالية: المانعُ الأوّل بضغطة، لا بالبحث عنه في القائمة */}
              {!isClosed && firstBlocker && (
                <a href={`#check-${firstBlocker.id}`} className={buttonClass("primary", "md")}>
                  <T s="إلى المانع {0}" a={[<ArrowLeft key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></a>
              )}
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
              /*
                ما اجتاز كلَّه سطرٌ مطويّ — القائمةُ لما بقي، والسليمُ يُفتح لمن
                يريد التحقّق منه. والطيُّ يتحرّك ولا يقفز (`details` في `globals.css`).
              */
              return (
                <li key={s.id} className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
                  <details open={st !== "PASS"} className="group/step">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition-colors hover:bg-hover sm:px-5 group-open/step:border-b group-open/step:border-line-soft [&::-webkit-details-marker]:hidden">
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
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform duration-(--dur-3) group-open/step:rotate-180" strokeWidth={2} aria-hidden />
                  </summary>
                  <ul className="divide-y divide-line-soft">
                    {s.items.map((i) => {
                      const iu = STATE_UI[i.state];
                      return (
                        <li key={i.id} id={`check-${i.id}`} className="flex scroll-mt-28 items-start gap-3 px-4 py-3 target:bg-accent-soft/60 sm:px-5">
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
                              <T s="أصلح {0}" a={[<ArrowLeft key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  </details>
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
              <h3 className="text-[15px] font-bold"><T s="رصيدا الحساب في {0}" a={[formatMonth(month)]} /></h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                اكتبهما كما في كشف البنك: الرصيد قبل أول حركة في الشهر، والرصيد بعد آخر حركة. بهما تُفحص المعادلة: الافتتاحي + الداخل − الخارج = الختامي.
              </p>
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="font-bold text-ink-soft">الرصيد الافتتاحي</span>
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
                  <span className="font-bold text-ink-soft">الرصيد الختامي</span>
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
                aria-busy={busy === "balancing"}
                type="submit"
                disabled={busy !== null || !opening.trim() || !closing.trim()}
                className={`${buttonClass("primary", "sm")} mt-4`}
              >
                احفظ الرصيدين وأعد الفحص
              </button>
            </form>
          )}

          {/* ── الإقفال ── */}
          {!isClosed ? (
            <section className="rounded-xl border border-line bg-raised p-5 shadow-raised">
              <h3 className="flex items-center gap-2 text-[15px] font-bold">
                <T s="{0}{1} الإقفال" a={[<Lock key="0" className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />, <span key="1" className="nums text-muted">{grouped.length + 1}.</span>]} /></h3>
              {report.canClose ? (
                <>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                    <T s="{0}بعد الإقفال لن يقبل الأرشيف أي مستند جديد لهذا الشهر، ويمكنك إعادة فتحه إن وصلت فاتورة متأخرة." a={[report.warnings.length === 0
                      ? "لا مانع من الإقفال ولا تنبيهات. "
                      : `لا مانع، لكن هناك ${countNoun(report.warnings.length, WARNING)} ستقرّ بها. `]} /></p>
                  {report.warnings.length > 0 && (
                    <label className="mt-3 block text-xs">
                      <span className="font-bold text-ink-soft">سبب الإقفال مع التنبيهات</span>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="يُحفظ في سجل التدقيق"
                        dir="auto"
                        className="mt-1.5 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
                      />
                    </label>
                  )}
                  <div className="mt-4">
                    <ConfirmAction
                      label={`أقفل ${formatMonth(month)}`}
                      variant="primary"
                      tone="warn"
                      size="md"
                      block
                      disabled={busy !== null}
                      title={`إقفال ${formatMonth(month)}`}
                      consequence={
                        report.warnings.length > 0
                          ? `بعد الإقفال لن يقبل الأرشيف أي مستند لهذا الشهر، وستقرّ بـ${countNoun(report.warnings.length, WARNING)} كما هو. ويمكنك إعادة فتحه إن وصلت فاتورة متأخرة.`
                          : "بعد الإقفال لن يقبل الأرشيف أي مستند لهذا الشهر، ويمكنك إعادة فتحه إن وصلت فاتورة متأخرة."
                      }
                      acknowledgement={`أقرّ بأن كل فواتير ${formatMonth(month)} وصلت، وأن التنبيهات الباقية مقصودة لا سهو.`}
                      confirmLabel={`أقفل ${formatMonth(month)}`}
                      onConfirm={() => call("close", month)}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                  <T s="{0} هذه أخطاء في البيانات نفسها، لا أمور تقرّ بها. أصلحها بأزرار «أصلح» أعلاه، ثم أعد الفحص." a={[<span key="0" className="font-bold text-danger"><T s="{0} {1} قبل الإقفال." a={[countNoun(report.blockers.length, BLOCKER), mustBeResolved(report.blockers.length)]} /></span>]} /></p>
              )}
            </section>
          ) : (
            <section className="rounded-xl border border-line bg-raised p-5 shadow-raised">
              <h3 className="flex items-center gap-2 text-[15px] font-bold">
                <T s="{0} هذا الشهر مقفل" a={[<Lock key="0" className="h-4 w-4 text-ok" strokeWidth={2} aria-hidden />]} /></h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">
                لا يقبل الأرشيف مستندات جديدة لهذا الشهر. إن وصلتك فاتورة متأخرة تخصه فأعد فتحه، وسيُسجَّل ذلك باسمك.
              </p>
              <div className="mt-4">
                <ConfirmAction
                  label="أعد فتح الشهر"
                  variant="secondary"
                  tone="warn"
                  disabled={busy !== null}
                  title={`إعادة فتح ${formatMonth(month)}`}
                  consequence="سيقبل الأرشيف مستندات جديدة لهذا الشهر، وتُسجَّل إعادة الفتح في سجل التدقيق باسمك. وستتغيّر تقارير الشهر بما يُضاف بعدها."
                  acknowledgement="أقرّ بأن عندي ما يخص هذا الشهر ولم يُضَف إليه."
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
                <h3 className="text-[15px] font-bold"><T s="حزمة المحاسب: {0}" a={[formatMonth(month)]} /></h3>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                  <T s="ملف Excel من ست أوراق (الملخص · الفواتير · الضريبة · الدفعات · المصروفات · حركات البنك)، أو نسخة للطباعة أو الحفظ بصيغة PDF بالأرقام نفسها.{0}" a={[isClosed ? " الشهر مقفل، فأرقامه ثابتة." : " الشهر مفتوح، وقد تتغيّر أرقامه بعد التنزيل، وهذا مذكور في الملف."]} /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/api/export/accountant?month=${month}`} download className={buttonClass(isClosed ? "primary" : "secondary")}>
                  <T s="{0}نزّل Excel" a={[<Download key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></a>
                <Link href={`/close/pack?month=${month}`} className={buttonClass("secondary")}>
                  <T s="{0}اعرضها للطباعة" a={[<Printer key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></Link>
              </div>
            </div>
          </section>

          {isClosed && (
            <p className="flex items-center gap-1.5 text-[11px] text-muted">
              <T s="{0}تُسجَّل إعادة الفتح والإقفال في سجل التدقيق بالاسم والوقت." a={[<Unlock key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></p>
          )}
        </>
      )}
    </div>
  );
}
