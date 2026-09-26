"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, FileCheck2, FileQuestion, ScanSearch } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { documentHref } from "@/lib/document-labels";
import { formatDay } from "@/lib/riyadh-time";
import { INVOICE, PAYMENT, countNoun } from "@/lib/arabic";
import type { AccountReviewPreview, AccountReviewResult } from "@/services/account-review.service";
import { Money } from "./money";
import { buttonClass, type ButtonVariant } from "./ui-tokens";
import { Sheet, toast } from "./ui-client";

/**
 * «راجِع الحسابات» — يعيد مطابقة كلّ فاتورةٍ بمورّدها وكلّ دفعةٍ بحوالتها.
 *
 * يفتح ورقةً تقول ما سيقع قبل أن يقع: فواتيرُ أُرشفت ولم تُقيَّد تُقيَّد
 * آلياً، ودفعاتٌ قُيِّدت مرّتين تُدمج **بإقرارك** (مختارةٌ ويُرفع الاختيار)،
 * وما يُترك لقرارك بسببه ورابطِ ملفّه. ثمّ «نفّذ» — وبعدها يُقال ما وقع.
 */
export function AccountReview({ variant = "secondary", size = "md" }: { variant?: ButtonVariant; size?: "sm" | "md" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AccountReviewPreview | null>(null);
  const [result, setResult] = useState<AccountReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  async function start() {
    setOpen(true);
    setResult(null);
    setError(null);
    setLoading(true);
    const r = await postJson<{ preview: AccountReviewPreview }>("/api/account-review", { preview: true });
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPreview(r.data.preview);
    setChosen(new Set(r.data.preview.echoes.map((e) => e.key)));
  }

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ result: AccountReviewResult }>("/api/account-review", {
      preview: false,
      echoKeys: [...chosen],
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r.data.result);
    const res = r.data.result;
    const parts = [
      res.invoices.recorded > 0 ? `قُيِّدت ${countNoun(res.invoices.recorded, INVOICE)}` : null,
      res.merged.length > 0 ? `دُمجت ${countNoun(res.merged.length, PAYMENT)} قُيِّدت مرّتين` : null,
      res.creditApplied > 0 ? `نُسب ${countNoun(res.creditApplied, PAYMENT)} إلى فواتيرها` : null,
    ].filter(Boolean);
    toast({
      tone: parts.length > 0 ? "ok" : "info",
      title: parts.length > 0 ? "رُوجعت الحسابات" : "الحساباتُ كما هي",
      body: parts.length > 0 ? parts.join(" · ") : "لم يجد ما يُقيَّد أو يُدمج آلياً.",
    });
    router.refresh();
  }

  function toggle(key: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const p = preview;
  const nothing = p && p.invoices.items.length === 0 && p.echoes.length === 0;

  return (
    <>
      <button type="button" onClick={start} className={buttonClass(variant, size)}>
        <ScanSearch className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2} aria-hidden />
        راجِع الحسابات
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="مراجعةُ الحسابات"
        description="يطابق كلَّ فاتورةٍ في الأرشيف بمورّدها، وكلَّ دفعةٍ بحوالتها في الكشف — ويقول ما سيقع قبل أن يقع."
        size="md"
        footer={
          result ? (
            <button type="button" className={buttonClass("primary")} onClick={() => setOpen(false)}>تمّ</button>
          ) : (
            <>
              <button type="button" className={buttonClass("quiet")} disabled={busy} onClick={() => setOpen(false)}>إلغاء</button>
              <button
                type="button"
                aria-busy={busy}
                className={buttonClass("primary")}
                disabled={busy || loading || !p}
                onClick={run}
              >
                {nothing ? "انسب الأرصدة وحدها" : "نفّذ"}
              </button>
            </>
          )
        }
      >
        {error && <p role="alert" className="mb-4 rounded-lg bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}

        {loading && (
          <div className="space-y-3" aria-busy="true" aria-label="يراجع…">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-sunken" />)}
          </div>
        )}

        {result && <ReviewResult result={result} />}

        {p && !result && !loading && (
          <div className="space-y-6">
            <section aria-labelledby="ar-invoices">
              <h3 id="ar-invoices" className="flex items-center gap-2 text-sm font-bold">
                <FileCheck2 className="h-4 w-4 text-ok" strokeWidth={2} aria-hidden />
                {p.invoices.items.length > 0
                  ? `تُقيَّد آلياً — ${countNoun(p.invoices.items.length, INVOICE)}`
                  : "لا فاتورةَ في الأرشيف تنتظر قيداً آلياً"}
              </h3>
              {p.invoices.items.length > 0 && (
                <>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    مورّدُها معروف، ورقمُها وتاريخُها ومبلغُها مقروءة، وليست نسخةً من فاتورةٍ مقيَّدة — بالرقم بأيّ صيغة، ولا باليوم والمبلغ.
                  </p>
                  <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line-soft">
                    {p.invoices.items.map((it) => (
                      <li key={it.documentId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{it.supplierName}</span>
                          <span className="block truncate text-muted" dir="auto">
                            {it.kind === "STATEMENT" ? "كشف حساب" : it.invoiceNumber} · {formatDay(it.invoiceDate)}
                            {it.wasArchived ? " · أُرشف بلا قيد" : ""}
                          </span>
                        </span>
                        {it.totalMinor !== null ? <Money minor={it.totalMinor} /> : <span className="text-muted">غير معروف</span>}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            {p.echoes.length > 0 && (
              <section aria-labelledby="ar-echoes">
                <h3 id="ar-echoes" className="flex items-center gap-2 text-sm font-bold">
                  <Copy className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden />
                  {`دفعاتٌ قُيِّدت مرّتين — ${countNoun(p.echoes.length, PAYMENT)}`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  حوالةٌ في كشف البنك لم تُنسب إلى فاتورة، وإقرارٌ باليد «سُدّدت» بالمبلغ نفسه بلا حركة بنك. فالحسابُ يبدو متّزناً وفاتورةٌ أحدث لم تُسدَّد.
                  الدمجُ يُلغي الإقرار وينقل سدادَه إلى الحوالة — فتظهر الفاتورةُ غيرُ المسدَّدة عليك.
                </p>
                <ul className="mt-2 space-y-2">
                  {p.echoes.map((e) => (
                    <li key={e.key}>
                      <label className="flex cursor-pointer gap-3 rounded-lg border border-line-soft p-3 text-xs has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                          checked={chosen.has(e.key)}
                          onChange={() => toggle(e.key)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-bold">{e.supplierName}</span>
                            <Money minor={e.amountMinor} />
                          </span>
                          <span className="mt-1 block leading-relaxed text-muted">
                            حوالةُ الكشف {formatDay(e.bankDay)} · وإقرارٌ باليد {formatDay(e.manualDay)}
                            {e.invoices.length > 0 && <> سدّد {e.invoices.map((i) => i.number).join("، ")}</>}
                          </span>
                        </span>
                      </label>
                      {e.supplierSlug && (
                        <Link href={`/suppliers/${e.supplierSlug}?tab=payments#detail`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
                          دفعاتُ {e.supplierName}
                          <ArrowLeft className="h-3 w-3" aria-hidden />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {p.invoices.missing.length > 0 && <LeftForYou missing={p.invoices.missing} />}

            {nothing && p.invoices.missing.length === 0 && (
              <p className="text-xs leading-relaxed text-muted">
                كلُّ فاتورةٍ في الأرشيف مقيَّدة، ولا دفعةَ قُيِّدت مرّتين. «انسب الأرصدة» يخصم ما دفعتَه ولم يُنسب من فواتير كلّ مورّد.
              </p>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}

function LeftForYou({ missing }: { missing: AccountReviewPreview["invoices"]["missing"] }) {
  return (
    <section aria-labelledby="ar-left">
      <h3 id="ar-left" className="flex items-center gap-2 text-sm font-bold">
        <FileQuestion className="h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
        {`تُترك لقرارك — ${countNoun(missing.length, INVOICE)}`}
      </h3>
      <p className="mt-1 text-[11px] text-muted">لا تُقيَّد آلياً، ولكلٍّ سببُه. افتح ملفَّها لتكمل الناقص أو ترفضها.</p>
      <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line-soft">
        {missing.map((m) => (
          <li key={m.documentId}>
            <Link href={documentHref(m.documentId, "fix")} className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-sunken">
              <span className="min-w-0">
                <span className="block truncate font-bold" dir="auto">{m.fileName}</span>
                <span className="block text-muted">{m.reasons.join(" · ")}</span>
              </span>
              <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewResult({ result }: { result: AccountReviewResult }) {
  const rows = [
    { label: "فواتيرُ قُيِّدت", value: result.invoices.recorded },
    { label: "دفعاتٌ دُمجت", value: result.merged.length },
    { label: "دفعاتٌ نُسبت إلى فواتيرها", value: result.creditApplied },
  ];
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-3 gap-2">
        {rows.map((r) => (
          <div key={r.label} className="rounded-lg bg-sunken px-3 py-2.5">
            <dt className="text-[11px] text-muted">{r.label}</dt>
            <dd className="nums mt-1 text-lg font-bold">{r.value}</dd>
          </div>
        ))}
      </dl>
      {result.merged.length > 0 && (
        <ul className="space-y-1 text-xs">
          {result.merged.map((m) => (
            <li key={m.key}>{m.supplierName}: انتقل <Money minor={m.movedMinor} /> إلى حوالة الكشف</li>
          ))}
        </ul>
      )}
      {result.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warn-bg px-3 py-2 text-[11px] text-warn">
          {result.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {result.invoices.missing.length > 0 && <LeftForYou missing={result.invoices.missing} />}
    </div>
  );
}
