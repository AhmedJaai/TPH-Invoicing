"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleHelp, Copy, FileCheck2, FileQuestion, Link2, ScanSearch } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { documentHref } from "@/lib/document-labels";
import { formatDay } from "@/lib/riyadh-time";
import { INVOICE, PAYMENT, TRANSACTION, countNoun } from "@/lib/arabic";
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
  const [chosenLinks, setChosenLinks] = useState<Set<string>>(new Set());

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
    setChosen(new Set([...r.data.preview.echoes.map((e) => e.key), ...r.data.preview.creditEchoes.map((e) => e.key)]));
    setChosenLinks(new Set(r.data.preview.links.filter((l) => !l.exact).map((l) => l.key)));
  }

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ result: AccountReviewResult }>("/api/account-review", {
      preview: false,
      echoKeys: [...chosen],
      linkKeys: [...chosenLinks],
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r.data.result);
    const res = r.data.result;
    const parts = [
      res.invoices.recorded > 0 ? `تم قيد ${countNoun(res.invoices.recorded, INVOICE)}` : null,
      res.merged.length > 0 ? `تم دمج ${countNoun(res.merged.length, PAYMENT)} قُيّدت مرتين` : null,
      res.linked.length > 0 ? `تم ربط ${countNoun(res.linked.length, TRANSACTION)} بسداد سجّلته يدوياً` : null,
      res.creditApplied > 0 ? `تم تخصيص ${countNoun(res.creditApplied, PAYMENT)} على فواتيرها` : null,
    ].filter(Boolean);
    toast({
      tone: parts.length > 0 ? "ok" : "info",
      title: parts.length > 0 ? "تمت مراجعة الحسابات" : "الحسابات كما هي",
      body: parts.length > 0 ? parts.join(" · ") : "لم يجد النظام ما يقيّده أو يدمجه تلقائياً.",
    });
    router.refresh();
  }

  function toggleLink(key: string) {
    setChosenLinks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
  const nothing = p && p.invoices.items.length === 0 && p.echoes.length === 0 && p.creditEchoes.length === 0 && p.links.length === 0;

  return (
    <>
      <button type="button" onClick={start} className={buttonClass(variant, size)}>
        <ScanSearch className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2} aria-hidden />
        راجع الحسابات
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="مراجعة الحسابات"
        description="يطابق كل فاتورة في الأرشيف بمورّدها، وكل دفعة بحوالتها في الكشف، ويعرض لك ما سيحدث قبل التنفيذ."
        size="md"
        footer={
          result ? (
            <button type="button" className={buttonClass("primary")} onClick={() => setOpen(false)}>تم</button>
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
                {nothing ? "خصّص الأرصدة فقط" : "نفّذ"}
              </button>
            </>
          )
        }
      >
        {error && <p role="alert" className="mb-4 rounded-lg bg-danger-bg px-3 py-2 text-xs font-bold text-danger">{error}</p>}

        {loading && (
          <div className="space-y-3" aria-busy="true" aria-label="جارٍ المراجعة…">
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
                  ? `تُقيَّد تلقائياً: ${countNoun(p.invoices.items.length, INVOICE)}`
                  : "لا توجد فواتير في الأرشيف تنتظر القيد التلقائي"}
              </h3>
              {p.invoices.items.length > 0 && (
                <>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted">
                    مورّدها معروف، ورقمها وتاريخها ومبلغها مقروءة، وليست نسخة من فاتورة مقيّدة (لا بالرقم بأي صيغة، ولا باليوم والمبلغ).
                  </p>
                  <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line-soft">
                    {p.invoices.items.map((it) => (
                      <li key={it.documentId} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{it.supplierName}</span>
                          <span className="block truncate text-muted" dir="auto">
                            {it.kind === "STATEMENT" ? "كشف حساب" : it.invoiceNumber} · {formatDay(it.invoiceDate)}
                            {it.wasArchived ? " · أُرشفت بلا قيد" : ""}
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
                  {`دفعات قُيّدت مرتين: ${countNoun(p.echoes.length, PAYMENT)}`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  حوالة في كشف البنك لم تُخصَّص على فاتورة، وسداد سجّلته يدوياً بالمبلغ نفسه دون حركة بنك. فيبدو الحساب متوازناً بينما فاتورة أحدث لم تُسدَّد.
                  الدمج يلغي السداد اليدوي وينقل أثره إلى الحوالة، فتظهر الفاتورة غير المسدّدة مستحقة عليك.
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
                            حوالة الكشف {formatDay(e.bankDay)} · وسداد يدوي {formatDay(e.manualDay)}
                            {e.invoices.length > 0 && <> سدّدت {e.invoices.map((i) => i.number).join("، ")}</>}
                          </span>
                        </span>
                      </label>
                      {e.supplierSlug && (
                        <Link href={`/suppliers/${e.supplierSlug}?tab=payments#detail`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
                          دفعات {e.supplierName}
                          <ArrowLeft className="h-3 w-3" aria-hidden />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {p.creditEchoes.length > 0 && (
              <section aria-labelledby="ar-credit-echoes">
                <h3 id="ar-credit-echoes" className="flex items-center gap-2 text-sm font-bold">
                  <Copy className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden />
                  {`سداد يدوي يقابله رصيد حوالة غير مخصّصة: ${countNoun(p.creditEchoes.length, PAYMENT)}`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  وسمتَ الفاتورة «سُدّدت» يدوياً، وللمورّد نفسه حوالة سابقة في الكشف لم تُخصَّص على فاتورة وتكفي لسدادها، فحُسب المال مرتين:
                  مرة سداداً ومرة «رصيداً لك». الدمج يلغي السداد اليدوي ويسدّد الفاتورة من تلك الحوالة، فينقص الرصيد بقدرها.
                </p>
                <ul className="mt-2 space-y-2">
                  {p.creditEchoes.map((e) => (
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
                            سداد يدوي {formatDay(e.manualDay)}
                            {e.invoices.length > 0 && <> لـ{e.invoices.map((i) => i.number).join("، ")}</>}
                            {" · من حوالة "}{e.sources.map((x) => formatDay(x.day)).join(" و")}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {p.links.length > 0 && (
              <section aria-labelledby="ar-links">
                <h3 id="ar-links" className="flex items-center gap-2 text-sm font-bold">
                  <Link2 className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
                  {`حوالات في الطابور سدادها مسجّل يدوياً: ${countNoun(p.links.length, TRANSACTION)}`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  رفعتَ الفاتورة وسجّلتَ أنها «سُدّدت» فأُغلقت، ثم جاء الكشف بحوالتها فلم يجد فاتورة مفتوحة. الربط يجعل الحوالة دليلاً على ذلك السداد، ولا ينشئ دفعة ثانية.
                </p>
                <ul className="mt-2 space-y-2">
                  {p.links.map((l) => (
                    <li key={l.key}>
                      <label className={`flex gap-3 rounded-lg border border-line-soft p-3 text-xs ${l.exact ? "" : "cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40"}`}>
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                          checked={l.exact || chosenLinks.has(l.key)}
                          disabled={l.exact}
                          onChange={() => toggleLink(l.key)}
                          aria-describedby={`${l.key}-why`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="font-bold">{l.supplierName}</span>
                            <Money minor={l.transferMinor} />
                          </span>
                          <span id={`${l.key}-why`} className="mt-1 block leading-relaxed text-muted">
                            حوالة {formatDay(l.transferDay)} · وسداد يدوي {formatDay(l.paymentDay)} بـ<Money minor={l.paymentMinor} />
                            {l.invoices.length > 0 && <> لـ{l.invoices.map((i) => i.number).join("، ")}</>}
                            {l.exact
                              ? " — المبلغ نفسه، فيُربط تلقائياً."
                              : <> — الحوالة أكبر بمقدار <Money minor={l.extraMinor} />، ويبقى رصيداً للمورّد. فإن كان ضمن الفاتورة (توصيل مثلاً) فصحّح إجماليها ليُخصم منه.</>}
                          </span>
                        </span>
                      </label>
                      {!l.exact && l.invoices[0] && (
                        <Link href={`/purchases/invoices/${l.invoices[0].id}?act=fix#fix`} className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-accent hover:underline">
                          صحّح إجمالي {l.invoices[0].number}
                          <ArrowLeft className="h-3 w-3" aria-hidden />
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {p.unproven.length > 0 && (
              <section aria-labelledby="ar-unproven">
                <h3 id="ar-unproven" className="flex items-center gap-2 text-sm font-bold">
                  <CircleHelp className="h-4 w-4 text-warn" strokeWidth={2} aria-hidden />
                  {`حوالات سجّلتها يدوياً ولا تظهر في الكشف: ${countNoun(p.unproven.length, PAYMENT)}`}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  يومها داخل الفترة المستوردة من كشف البنك ولا توجد حوالة تقابلها. فإما أنك دفعت من حساب آخر، فسجّلها «من حساب المالك» من فاتورتها،
                  وإما أنك لم تدفع بعد. لا يتغيّر فيها شيء هنا.
                </p>
                <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line-soft">
                  {p.unproven.map((u) => (
                    <li key={u.paymentId}>
                      <Link
                        href={u.invoices[0] ? `/purchases/invoices/${u.invoices[0].id}` : `/suppliers/${u.supplierSlug}?tab=payments#detail`}
                        className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-sunken"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{u.supplierName}</span>
                          <span className="block truncate text-muted" dir="auto">
                            {formatDay(u.day)}{u.invoices.length > 0 ? ` · ${u.invoices.map((i) => i.number).join("، ")}` : " · لم تُخصَّص على فاتورة"}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <Money minor={u.amountMinor} />
                          <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {p.invoices.missing.length > 0 && <LeftForYou missing={p.invoices.missing} />}

            {nothing && p.invoices.missing.length === 0 && p.unproven.length === 0 && (
              <p className="text-xs leading-relaxed text-muted">
                كل فاتورة في الأرشيف مقيّدة، ولا توجد دفعة قُيّدت مرتين. «خصّص الأرصدة» يخصم ما دفعته ولم يُخصَّص من فواتير كل مورّد.
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
        {`تنتظر قرارك: ${countNoun(missing.length, INVOICE)}`}
      </h3>
      <p className="mt-1 text-[11px] text-muted">لا تُقيَّد تلقائياً، ولكل فاتورة سببها. افتح ملفها لتكمل الناقص أو ارفضها.</p>
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
    { label: "فواتير قُيّدت", value: result.invoices.recorded },
    { label: "دفعات دُمجت", value: result.merged.length },
    { label: "حوالات رُبطت", value: result.linked.length },
    { label: "دفعات خُصّصت على فواتيرها", value: result.creditApplied },
  ];
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <li key={m.key}>{m.supplierName}: انتقل مبلغ <Money minor={m.movedMinor} /> إلى حوالة الكشف</li>
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
