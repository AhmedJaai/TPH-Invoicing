import { Truck } from "lucide-react";
import { formatDay } from "@/lib/riyadh-time";
import { countNoun, INVOICE, LINE } from "@/lib/arabic";
import type { LateInvoice } from "@/services/inventory-late-invoices.service";
import { Money } from "./money";
import { PostAction } from "./post-action";
import { T } from "@/components/i18n/t";

/**
 * فواتيرُ تلت نهايةَ الجرد بأيّامٍ قليلة — وزرُّ القرار فيها.
 *
 * كان التنبيهُ يقول «هل وصلت البضاعة قبل نهاية الفترة؟ قرّر في الخطوة الثانية» ولا زرَّ في الخطوة الثانية
 * (أحمد، ١ نوفمبر ٢٠٢٦). فهنا السؤالُ وجوابُه: **وصلت بعد الجرد** فلا تدخله وتُحسب في التالي، أو **قبل نهايته**
 * فتدخله. والجوابُ يُكتب على الفاتورة (`received_on`)، ويُنقَض بـ«غيّر القرار».
 */
export function LateInvoicesPanel({
  rows,
  periodEnd,
  canEdit,
  locked,
  showAmounts,
}: {
  rows: readonly LateInvoice[];
  periodEnd: string;
  canEdit: boolean;
  locked: boolean;
  showAmounts: boolean;
}) {
  if (rows.length === 0) return null;
  const pending = rows.filter((r) => r.receivedOn === null).length;
  return (
    <section className="mb-6 rounded-2xl border border-line bg-raised p-4 sm:p-5" aria-labelledby="late-invoices-title">
      <div className="flex flex-wrap items-start gap-3">
        <Truck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id="late-invoices-title" className="text-sm font-bold">
            {pending > 0
              ? <T s="{0} جاءت بعد نهاية الجرد بأيام: متى وصلت بضاعتها؟" a={[countNoun(pending, INVOICE)]} />
              : <>فواتير جاءت بعد نهاية الجرد بأيام، وقد قرّرت فيها كلها</>}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            <T s="المورّد قد يسلّم قبل أن يصدر فاتورته. إن وصلت البضاعة بعد {0} فلا تدخل هذا الجرد وتُحسب في الجرد التالي، وإن وصلت قبله دخلت فيه. وبلا قرارك لا تُحسب ولا تُسقط." a={[<bdi key="0">{formatDay(periodEnd)}</bdi>]} />
          </p>
          {locked && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              الجرد مقفل: قرارك يُحفظ على الفاتورة، ولا تتغير أرقام هذا الجرد ولا التنبيه فوقه حتى تعيد فتحه ويُعاد حسابه.
            </p>
          )}
        </div>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {rows.map((r) => {
          const after = r.receivedOn !== null && r.receivedOn > periodEnd;
          return (
            <li key={r.invoiceId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="text-[13px] font-bold">{r.supplierName} <span className="nums font-normal text-muted">· {r.invoiceNumber}</span></p>
                <p className="mt-0.5 text-[11px] text-muted">
                  <T s="فاتورة {0} · {1}{2}" a={[<bdi key="0">{formatDay(r.invoiceDay)}</bdi>, countNoun(r.lineCount, LINE), showAmounts ? <span key="2"> · <Money minor={r.totalMinor} currency /></span> : null]} />
                </p>
              </div>
              {canEdit && r.receivedOn === null && (
                <div className="flex flex-wrap items-center gap-2">
                  <PostAction
                    url="/api/inventory/invoice-received"
                    body={{ invoiceId: r.invoiceId, receivedOn: r.invoiceDay }}
                    undo={{ body: { invoiceId: r.invoiceId, receivedOn: null } }}
                    variant="primary"
                  >
                    وصلت بعد الجرد، لا تدخله
                  </PostAction>
                  <PostAction
                    url="/api/inventory/invoice-received"
                    body={{ invoiceId: r.invoiceId, receivedOn: periodEnd }}
                    undo={{ body: { invoiceId: r.invoiceId, receivedOn: null } }}
                  >
                    وصلت قبل نهايته، يدخله
                  </PostAction>
                </div>
              )}
              {r.receivedOn !== null && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={after ? "font-bold text-ink-soft" : "font-bold text-ok"}>
                    {after ? "قرّرت: وصلت بعد الجرد، فلا تدخله" : <T s="قرّرت: وصلت يوم {0}، فتدخله" a={[<bdi key="0">{formatDay(r.receivedOn)}</bdi>]} />}
                  </span>
                  {canEdit && (
                    <PostAction url="/api/inventory/invoice-received" body={{ invoiceId: r.invoiceId, receivedOn: null }} variant="quiet">
                      غيّر القرار
                    </PostAction>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
