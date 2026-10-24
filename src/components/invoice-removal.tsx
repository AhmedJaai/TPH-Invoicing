"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatDay } from "@/lib/riyadh-time";
import { formatRiyalsDisplay } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/payment-state";
import { Money } from "./money";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

type Choice = { mode: "release"; reallocate: boolean } | { mode: "move"; targetId: string };

interface Balance { owedMinor: number; creditLeftMinor: number }
interface RemovalPreviewView {
  facts: {
    invoice: { id: string; number: string; totalMinor: number; virtual: boolean; fileMissing: boolean };
    supplier: { name: string; slug: string };
    allocations: { paymentId: string; amountMinor: number; paidOn: string; method: string; bankLinked: boolean }[];
    allocatedMinor: number;
    statementLines: number;
    targets: { id: string; number: string; date: string; totalMinor: number; openMinor: number }[];
    refusal: string | null;
  };
  outcome: {
    movedMinor: number; reappliedMinor: number; leftAsCreditMinor: number;
    balance: { before: Balance; after: Balance };
  } | null;
}

/** «عليك له» أو «لك عنده» — الرصيدُ بجهته لا بإشارة. */
function BalanceLine({ b }: { b: Balance }) {
  if (b.creditLeftMinor > 0) return <T s="لك عنده {0}" a={[<Money key="0" minor={b.creditLeftMinor} />]} />;
  if (b.owedMinor > 0) return <T s="عليك له {0}" a={[<Money key="0" minor={b.owedMinor} />]} />;
  return <>متّزن</>;
}

/**
 * «حذف القيد» على صفحة الفاتورة — للمالك وحده (`invoice-removal.service.ts`).
 *
 * المعاينةُ من الخادم مع كلّ اختيار: ما يُفكّ، وأين يذهب، و«عليك» قبل وبعد. ولا يُرسَل مبلغ.
 * والدفعاتُ لا تُحذف: تبقى رصيداً، أو تُوزَّع بالأقدم أوّلاً، أو تنتقل إلى فاتورةٍ يختارها.
 */
export function InvoiceRemoval({ invoiceId, initial = null, redirectTo }: {
  invoiceId: string;
  /** «حذف القيد» من «يحتاج قرارك» (`?act=remove`): المعاينةُ محسوبةٌ في الخادم والصفحةُ تُفتح عليها */
  initial?: RemovalPreviewView | null;
  redirectTo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(initial !== null);
  const [choice, setChoice] = useState<Choice>({ mode: "release", reallocate: false });
  const [preview, setPreview] = useState<RemovalPreviewView | null>(initial);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* الحالُ تُكتب بعد الردّ وحده — فيصلح نداؤه من الأثر الأوّل ومن الضغطات */
  const fetchPreview = useCallback(async (c: Choice) => {
    const r = await postJson<RemovalPreviewView>("/api/invoice-remove", { action: "preview", invoiceId, choice: c });
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setPreview(r.data);
  }, [invoiceId]);

  function choose(c: Choice) {
    setChoice(c);
    setLoading(true);
    void fetchPreview(c);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message: string }>("/api/invoice-remove", { action: "remove", invoiceId, choice });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: "حُذف القيد", body: r.data.message });
    router.replace(redirectTo);
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); choose(choice); }} className={buttonClass("danger", "sm")}>
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
        احذف القيد
      </button>
    );
  }

  const f = preview?.facts;
  const o = preview?.outcome;
  const firstTarget = f?.targets[0]?.id;

  return (
    <div className="w-full rounded-xl border border-line bg-raised p-4 text-xs text-ink shadow-raised" aria-busy={loading}>
      {!f ? (
        <p className="text-muted">{error ?? "يحسب ما سيتغيّر…"}</p>
      ) : (
        <>
          <p className="leading-relaxed text-ink-soft">
            {f.allocations.length === 0
              ? <T s="لا سداد على {0}، فحذف قيدها يُخرج إجماليها ({1}) من المستحق فقط." a={[<bdi key="0" className="nums font-bold text-ink">{f.invoice.number}</bdi>, <Money key="1" minor={f.invoice.totalMinor} />]} />
              : <T s="على {0} سداد بمبلغ {1}. الدفعات نفسها لا تُحذف أبداً، فاختر أين يذهب ما خُصّص لها." a={[<bdi key="0" className="nums font-bold text-ink">{f.invoice.number}</bdi>, <Money key="1" minor={f.allocatedMinor} />]} />}
          </p>
          {f.allocations.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[11px] text-muted">
              {f.allocations.map((a) => (
                <li key={a.paymentId} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {formatDay(a.paidOn)} · {METHOD_LABEL[a.method] ?? a.method}
                    {a.bankLinked && " · مربوطة بحوالة في كشف البنك"}
                  </span>
                  <Money minor={a.amountMinor} />
                </li>
              ))}
            </ul>
          )}

          {f.refusal ? (
            <p role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 leading-relaxed text-danger">{f.refusal}</p>
          ) : (
            <>
              <fieldset className="mt-3 space-y-2" disabled={busy}>
                <legend className="mb-1 font-bold">ماذا تفعل بالقيد؟</legend>
                <label className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${choice.mode === "release" ? "border-accent bg-accent-soft" : "border-line"}`}>
                  <input type="radio" name={`rm-${invoiceId}`} checked={choice.mode === "release"} onChange={() => choose({ mode: "release", reallocate: false })} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">احذف القيد</span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {f.allocations.length > 0 ? "ما خُصّص لها يعود رصيداً لك عند المورّد." : "تخرج من المستحق، ويبقى أثرها في السجل."}
                    </span>
                    {choice.mode === "release" && f.allocations.length > 0 && (
                      <label className="mt-2 flex items-center gap-2 text-[11px]">
                        <input type="checkbox" checked={choice.reallocate} onChange={(e) => choose({ mode: "release", reallocate: e.target.checked })} />
                        ووزّعه بالأقدم أولاً على فواتيره المفتوحة
                      </label>
                    )}
                  </span>
                </label>
                <label className={`flex min-h-11 items-start gap-2.5 rounded-lg border px-3 py-2.5 ${choice.mode === "move" ? "border-accent bg-accent-soft" : "border-line"} ${f.allocations.length === 0 || !firstTarget ? "opacity-60" : "cursor-pointer"}`}>
                  <input
                    type="radio" name={`rm-${invoiceId}`} checked={choice.mode === "move"} className="mt-0.5"
                    disabled={f.allocations.length === 0 || !firstTarget}
                    onChange={() => firstTarget && choose({ mode: "move", targetId: firstTarget })}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">انقل سداده إلى فاتورة أخرى ثم احذف القيد</span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {f.allocations.length === 0 ? "لا سداد عليها لينتقل." : !firstTarget ? <T s="لا فاتورة مفتوحة أخرى من {0}." a={[f.supplier.name]} /> : "ومعه حوالة البنك المربوطة به. والمقترح أقدم فاتورة مفتوحة."}
                    </span>
                    {choice.mode === "move" && (
                      <select
                        aria-label="الفاتورة التي ينتقل إليها السداد"
                        value={choice.targetId}
                        onChange={(e) => choose({ mode: "move", targetId: e.target.value })}
                        className="mt-2 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-xs sm:min-h-8"
                      >
                        {f.targets.map((t, i) => (
                          <option key={t.id} value={t.id}>
                            {t.number} · {formatDay(t.date)} · بقي عليها {formatRiyalsDisplay(t.openMinor)}{i === 0 ? " (الأقدم)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                </label>
              </fieldset>

              {f.statementLines > 0 && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  {choice.mode === "move"
                    ? "سطرها في كشف المورّد ينتقل مع السداد إن لم يكن للفاتورة الأخرى سطر في الكشف نفسه."
                    : "سطرها في كشف المورّد يعود غير مطابق، فقد يظهر في الكشف «بلا ملف»."}
                </p>
              )}

              <div className="mt-3 rounded-lg border border-line-soft bg-sunken px-3 py-2">
                {o ? (
                  <p className="leading-relaxed">
                    <T s="رصيد {0}: قبل {1} · بعد {2}" a={[f.supplier.name, <BalanceLine key="1" b={o.balance.before} />, <strong key="2"><BalanceLine b={o.balance.after} /></strong>]} />
                    {o.movedMinor > 0 && <> <T s=" · ينتقل {0}" a={[<Money key="0" minor={o.movedMinor} />]} /></>}
                    {o.reappliedMinor > 0 && <> <T s=" · يُوزَّع {0}" a={[<Money key="0" minor={o.reappliedMinor} />]} /></>}
                    {o.leftAsCreditMinor > 0 && <> <T s=" · يبقى رصيداً {0}" a={[<Money key="0" minor={o.leftAsCreditMinor} />]} /></>}
                  </p>
                ) : (
                  <p className="text-muted">{loading ? "يحسب…" : "لم تُحسب المعاينة."}</p>
                )}
              </div>
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!f.refusal && (
              <button type="button" onClick={run} disabled={busy || loading || !o} aria-busy={busy} className={buttonClass("danger", "sm")}>
                {busy ? "يحذف…" : choice.mode === "move" ? "انقل السداد واحذف القيد" : "احذف القيد"}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("quiet", "sm")}>أبقِ القيد كما هو</button>
            {error && <span role="alert" className="text-danger">{error}</span>}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            {f.invoice.virtual ? "هذه سُجّلت من سطر كشف بلا ملف، فلا ورقة لها تُحذف." : "ملفها في الدرايف لا يُمسّ، ويُرفض مستندها هنا."} وكل ذلك في سجل التدقيق.
          </p>
        </>
      )}
    </div>
  );
}
