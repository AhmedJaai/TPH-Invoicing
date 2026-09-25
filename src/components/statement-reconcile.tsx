"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, Copy, FileSearch, GitCompareArrows, MessageCircle, ScrollText, Upload } from "lucide-react";
import { request } from "@/lib/http-client";
import { INVOICE, LINE, countNoun } from "@/lib/arabic";
import { formatRange } from "@/lib/riyadh-time";
import { Money } from "./money";
import { Badge, Callout, DataTable, EmptyState, Monogram, Section } from "./ui";
import { Sheet } from "./ui-client";
import { buttonClass } from "./ui-tokens";

export interface ArchivedStatement {
  id: string;
  supplierName: string;
  supplierSlug: string | null;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  /** `null` تعني «لم يُقرأ» — وتُعرَض «غير معروف» لا صفراً. */
  closingBalanceMinor: number | null;
  lineCount: number;
  matchedCount: number;
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

interface Result {
  persisted: boolean;
  fileName: string;
  supplier: { id: string; nameAr: string };
  period: { start: string; end: string };
  summary: {
    statementLines: number; ourInvoices: number; matched: number;
    missingFromArchive: number; amountMismatches: number; notInStatement: number;
    theirBilledMinor: number; theirPaidMinor: number; ourBilledMinor: number;
    billedDifferenceMinor: number; balanceArithmeticOk: boolean | null;
  };
  missing: { date: string; ref: string; amountMinor: number }[];
  mismatches: { invoiceNumber: string; theirsMinor: number; oursMinor: number; differenceMinor: number }[];
  extra: { invoiceNumber: string; date: string; amountMinor: number }[];
  /** أسطرٌ لم يُقرأ مبلغها أو تاريخها — لم تُطابَق ولم تُحذف. */
  unreadLines?: { date: string; description: string; amountText: string }[];
  memo: string;
}

/** الطلبُ والنتيجةُ المشتركان: زرٌّ يُرسل، وحالُ انتظاره، وخطؤه بجانبه، ولوحُ النتيجة. */
function useReconcile() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);

  const send = useCallback(
    async (body: FormData, key: string) => {
      setBusy(key);
      setError(null);
      try {
        const r = await request<Result & { persisted?: boolean }>("/api/statement-reconcile", { method: "POST", body });
        if (!r.ok) {
          setError({ key, text: r.error });
          return;
        }
        setResult(r.data);
        if (r.data.persisted) router.refresh();
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const sheet = (
    <Sheet
      open={result !== null}
      onClose={() => setResult(null)}
      size="lg"
      title={result ? `${result.supplier.nameAr} · ${formatRange(result.period.start, result.period.end)}` : "نتيجة المطابقة"}
      description={result ? (result.persisted ? "حُفظ الناتج مع الكشف." : "فحصٌ لم يُحفظ منه شيء.") : undefined}
      footer={<button type="button" onClick={() => setResult(null)} className={buttonClass("secondary")}>أغلق</button>}
    >
      {result && <ResultView result={result} />}
    </Sheet>
  );

  return { busy, error, send, sheet };
}

/**
 * الكشوفُ المؤرشفة ومطابقتُها.
 *
 * ما ينتظر أوّلاً: كشوفٌ أُرشفت ولم تُقرأ أسطرُها — والمطابقةُ هي التي
 * تقرؤها. ثمّ كلُّ الكشوف في جدولٍ يُبحث فيه. والنتيجةُ في لوحٍ فوق
 * الصفحة حيث ضُغط الزرّ — كانت تُلحَق بذيل الصفحة بعد قائمةٍ طويلة فلا
 * يُرى أنّ شيئاً حدث.
 */
export function StatementReconcile({ archived }: { archived: ArchivedStatement[] }) {
  const { busy, error, send, sheet } = useReconcile();

  const match = (id: string) => {
    const f = new FormData();
    f.append("statementId", id);
    void send(f, id);
  };

  const pending = archived.filter((a) => a.lineCount === 0);

  return (
    <div className="min-w-0 space-y-10">
      {/* ── ما ينتظر: كشوفٌ بلا أسطرٍ مقروءة ── */}
      {pending.length > 0 && (
        <Section
          title="تنتظر المطابقة"
          icon={GitCompareArrows}
          count={pending.length}
          className="mt-0"
          hint="أُرشفت ولم تُقرأ أسطرُها بعد — المطابقةُ تقرؤها وتقابل كلَّ سطرٍ بفواتيرك، وتكشف ما حمّله عليك ولم يصلك."
        >
          <ul className="space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="rounded-xl border border-line bg-raised shadow-raised">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                  <Monogram name={a.supplierName} className="h-9 w-9 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-bold">{a.supplierName}</span>
                    <span className="block text-[11px] text-muted">{formatRange(a.periodStart, a.periodEnd)}</span>
                  </span>
                  <span className="text-end">
                    <span className="block text-[11px] text-muted">رصيدُه الختاميّ</span>
                    <Closing minor={a.closingBalanceMinor} />
                  </span>
                  <button type="button" onClick={() => match(a.id)} disabled={busy !== null} className={buttonClass("primary", "sm")}>
                    <GitCompareArrows className="h-4 w-4" strokeWidth={2} aria-hidden />
                    {busy === a.id ? "يقرأ ويطابق…" : "طابِق"}
                  </button>
                </div>
                {error?.key === a.id && <p role="alert" className="border-t border-line-soft bg-danger-bg px-4 py-2 text-xs text-danger sm:px-5">{error.text}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── كلُّ الكشوف ── */}
      <Section
        title="كلُّ الكشوف المؤرشفة"
        icon={ScrollText}
        count={archived.length}
        className={pending.length > 0 ? "" : "mt-0"}
      >
        <DataTable
          rows={archived}
          keyOf={(a) => a.id}
          searchOf={(a) => `${a.supplierName} ${a.fileName}`}
          searchLabel="ابحث باسم المورّد"
          empty={
            <EmptyState
              compact
              icon={ScrollText}
              title="لا كشوف مؤرشفة بعد."
              hint="ارفع كشف المورّد من «الرفع» فيُؤرشَف، ثمّ طابقه هنا — أو افحصه قبل أرشفته من الجانب."
            />
          }
          columns={[
            {
              key: "supplier",
              header: "المورّد والفترة",
              primary: true,
              cell: (a) => (
                <span className="flex min-w-0 items-center gap-2.5">
                  <Monogram name={a.supplierName} />
                  <span className="min-w-0">
                    {a.supplierSlug ? (
                      <Link href={`/suppliers/${a.supplierSlug}?tab=statements#detail`} className="relative block truncate font-bold hover:text-accent">{a.supplierName}</Link>
                    ) : (
                      <span className="block truncate font-bold">{a.supplierName}</span>
                    )}
                    <span className="block text-[11px] font-normal text-muted">{formatRange(a.periodStart, a.periodEnd)}</span>
                  </span>
                </span>
              ),
            },
            {
              key: "lines",
              header: "أسطرُه",
              cell: (a) =>
                a.lineCount === 0 ? (
                  <Badge tone="warn" dot>لم تُقرأ</Badge>
                ) : (
                  <span className="whitespace-nowrap text-xs text-ink-soft">
                    طوبق <span className="nums">{a.matchedCount}</span> من <span className="nums">{a.lineCount}</span>
                  </span>
                ),
            },
            { key: "closing", header: "الرصيد الختاميّ", numeric: true, cell: (a) => <Closing minor={a.closingBalanceMinor} /> },
            {
              key: "act",
              header: "",
              align: "end",
              wrap: true,
              cell: (a) => (
                <span className="flex flex-col items-end gap-1">
                  <button type="button" onClick={() => match(a.id)} disabled={busy !== null} className={`${buttonClass(a.lineCount === 0 ? "primary" : "quiet", "sm")} relative whitespace-nowrap`}>
                    {busy === a.id ? "يقرأ ويطابق…" : a.lineCount > 0 ? "أعد المطابقة" : "طابِق"}
                  </button>
                  {error?.key === a.id && <span role="alert" className="max-w-56 text-[11px] text-danger">{error.text}</span>}
                </span>
              ),
            },
          ]}
        />
      </Section>
      {sheet}
    </div>
  );
}

/**
 * فحصُ كشفٍ وصل الآن قبل أرشفته — يُقرأ ويُطابَق ويُعرض ولا يُحفظ.
 */
export function StatementQuickCheck({
  suppliers,
  initialSupplierId,
}: {
  suppliers: SupplierOption[];
  /** المورّد الذي فُتحت الصفحة عليه من ملفّه — يُختار سلفاً. */
  initialSupplierId?: string;
}) {
  const { busy, error, send, sheet } = useReconcile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");

  return (
    <>
      {/* ── فحصٌ سريع لكشفٍ وصل الآن ── */}
      <div className="rounded-xl border border-accent-line bg-accent-soft/50 p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <FileSearch className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
          افحص كشفاً وصلك الآن
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          يُقرأ ويُطابَق ويُعرض — ولا يُحفظ منه شيء. للأرشفة ارفعه من «الرفع».
        </p>
        <label className="mt-3 block text-[11px] text-muted">
          المورّد
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-lg border border-line-input bg-raised px-2.5 text-sm sm:min-h-9"
          >
            <option value="">يُستنتج من الكشف</option>
            {suppliers.map((x) => (
              <option key={x.id} value={x.id}>{x.nameAr}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          className={`${buttonClass("primary", "sm")} mt-3 w-full`}
        >
          <Upload className="h-4 w-4" strokeWidth={2} aria-hidden />
          {busy === "upload" ? "يقرأ…" : "اختر ملفّ الكشف"}
        </button>
        <input
          ref={inputRef}
          aria-label="ملفّ كشف المورّد"
          type="file"
          accept=".pdf,image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const body = new FormData();
            body.append("file", f);
            if (supplierId) body.append("supplierId", supplierId);
            void send(body, "upload");
          }}
        />
        {error?.key === "upload" && <p role="alert" className="mt-2 text-xs text-danger">{error.text}</p>}
      </div>
      {sheet}
    </>
  );
}

function Closing({ minor }: { minor: number | null }) {
  return minor === null
    ? <span className="text-[13px] font-medium text-muted">غير معروف</span>
    : <span className="text-[13px] font-bold"><Money minor={minor} /></span>;
}

/* ───────────────────── النتيجة ───────────────────── */

function Count({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "danger" }) {
  const ink = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="rounded-lg border border-line-soft bg-raised px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`nums mt-1 text-lg font-bold leading-none ${ink}`}>{value}</p>
    </div>
  );
}

function ResultView({ result }: { result: Result }) {
  const s = result.summary;
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const clean = s.missingFromArchive === 0 && s.amountMismatches === 0 && s.billedDifferenceMinor === 0;

  return (
    <div className="space-y-5">
      {clean ? (
        <Callout tone="ok" icon={CircleCheck} title="كشفُه يوافق فواتيرك">
          لا فاتورة حمّلها عليك وليست عندك، ولا فرق في المبالغ.
        </Callout>
      ) : (
        <Callout tone={s.missingFromArchive > 0 ? "danger" : "warn"} icon={CircleAlert} title="في كشفه ما يخالف فواتيرك">
          {s.missingFromArchive > 0 && <>{countNoun(s.missingFromArchive, INVOICE)} حمّلها عليك ولا ملفّ لها عندك. </>}
          {s.amountMismatches > 0 && <>وفي {s.amountMismatches} فرقٌ في المبلغ. </>}
          والمذكّرةُ أسفلُ جاهزةٌ للمورّد.
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Count label="أسطرُ كشفه" value={s.statementLines} />
        <Count label="طوبقت" value={s.matched} tone="ok" />
        <Count label="حمّلها ولا ملفّ لها" value={s.missingFromArchive} tone={s.missingFromArchive ? "danger" : "ok"} />
        <Count label="فروقُ مبالغ" value={s.amountMismatches} tone={s.amountMismatches ? "warn" : "ok"} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line-soft bg-sunken/50 p-3 text-xs sm:grid-cols-4">
        <div><dt className="text-[11px] text-muted">ما حمّله علينا</dt><dd className="mt-1 font-bold"><Money minor={s.theirBilledMinor} /></dd></div>
        <div><dt className="text-[11px] text-muted">ما لدينا من فواتيره</dt><dd className="mt-1 font-bold"><Money minor={s.ourBilledMinor} /></dd></div>
        <div>
          <dt className="text-[11px] text-muted">الفرق</dt>
          <dd className={`mt-1 font-bold ${s.billedDifferenceMinor === 0 ? "text-ok" : "text-warn"}`}><Money minor={Math.abs(s.billedDifferenceMinor)} /></dd>
        </div>
        <div><dt className="text-[11px] text-muted">ما سدّدناه في كشفه</dt><dd className="mt-1 font-bold"><Money minor={s.theirPaidMinor} /></dd></div>
      </dl>

      {result.unreadLines && result.unreadLines.length > 0 && (
        <Callout tone="warn" icon={CircleAlert} title={`${countNoun(result.unreadLines.length, LINE)} لم يُقرأ مبلغُه أو تاريخُه`}>
          لم تُطابَق ولم تُحذف — راجعها في الكشف نفسه.
          <ul className="mt-1.5 space-y-0.5">
            {result.unreadLines.slice(0, 12).map((u, i) => (
              <li key={i} className="text-[11px]" dir="auto">
                <bdi className="nums">{u.date || "بلا تاريخ"}</bdi> · {u.description || "بلا وصف"} · <bdi className="nums">{u.amountText || "بلا مبلغ"}</bdi>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {s.balanceArithmeticOk === false && (
        <Callout tone="warn" icon={CircleAlert}>
          حسابُ الكشف نفسه لا يستقيم: الافتتاحيّ مع الحركات لا يعطي الرصيدَ الختاميّ المكتوب فيه.
        </Callout>
      )}

      {result.missing.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-danger">حمّلها عليك ولا ملفّ لها عندك — {result.missing.length}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">فاتورةٌ ناقصة لا يكشفها تفتيشُ أرشيفك، لأنّها ليست فيه.</p>
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-lg border border-danger/25">
            {result.missing.map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 bg-danger-bg px-3 py-2 text-xs">
                <bdi className="nums shrink-0 text-muted">{m.date}</bdi>
                <span className="min-w-0 flex-1 truncate" dir="auto">{m.ref}</span>
                <span className="shrink-0 font-bold"><Money minor={m.amountMinor} tone="danger" /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.mismatches.length > 0 && (
        <section>
          <h3 className="text-sm font-bold text-warn">فروقٌ في المبالغ</h3>
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-lg border border-warn/25">
            {result.mismatches.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 bg-warn-bg px-3 py-2 text-xs">
                <bdi dir="ltr" className="font-mono">{m.invoiceNumber}</bdi>
                <span className="text-ink-soft">عنده <Money minor={m.theirsMinor} /> · عندنا <Money minor={m.oursMinor} /></span>
                <span className="font-bold text-warn">{m.differenceMinor > 0 ? "+" : "−"}<Money minor={Math.abs(m.differenceMinor)} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.extra.length > 0 && (
        <section>
          <h3 className="text-sm font-bold">عندك ولم ترد في كشفه — {result.extra.length}</h3>
          <p className="mt-0.5 text-[11px] text-muted">تحقّق أنّها ليست مكرّرةً عندك، ولا تخصّ مورّداً آخر.</p>
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-lg border border-line">
            {result.extra.slice(0, 15).map((m, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <bdi dir="ltr" className="font-mono">{m.invoiceNumber}</bdi>
                <bdi className="nums text-muted">{m.date}</bdi>
                <span className="font-medium"><Money minor={m.amountMinor} /></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── مذكّرة الفروق ── */}
      <section>
        <h3 className="text-sm font-bold">مذكّرةٌ جاهزة للمورّد</h3>
        <pre dir="rtl" className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken p-3 font-sans text-[11px] leading-relaxed">
          {result.memo}
        </pre>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              /* رفضُ إذن الحافظة يُسمَع ولا يمرّ صامتاً */
              try {
                await navigator.clipboard.writeText(result.memo);
                setCopied("ok");
                setTimeout(() => setCopied("idle"), 2000);
              } catch {
                setCopied("fail");
              }
            }}
            className={buttonClass("secondary", "sm")}
          >
            <Copy className="h-4 w-4" strokeWidth={2} aria-hidden />
            {copied === "ok" ? "✓ نُسخت" : "انسخ المذكّرة"}
          </button>
          <a href={`https://wa.me/?text=${encodeURIComponent(result.memo)}`} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
            <MessageCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
            أرسلها واتساب
          </a>
          {copied === "fail" && (
            <span role="alert" className="text-[11px] text-danger">منع المتصفّحُ الحافظة — حدّد نصّ المذكّرة وانسخه بيدك.</span>
          )}
        </div>
      </section>
    </div>
  );
}

