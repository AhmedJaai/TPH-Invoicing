/**
 * أدلّةُ القراءة كما تُعرض لمن يراجع — في ملفّ المستند وفي بطاقة الرفع.
 *
 * ما قرأه النموذج اقتراح. وهذه البطاقة تقول ما **يُقابَل** به: رمزُ الفاتورة
 * الضريبيّ (كتبه نظامُ المورّد)، وأيُّ حقلٍ لم يقرأه النموذج فسُدّ من غيره ومن
 * أين، وما يستحقّ النظر قبل الاعتماد. ولا تمنع شيئاً: الحقولُ تُعدَّل في موضعها
 * والحكمُ لمن يراجع.
 */
import { CircleCheck, QrCode, TriangleAlert } from "lucide-react";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay } from "@/lib/riyadh-time";
import {
  QR_FIELD_LABEL, SOURCE_LABEL, evidenceWarnings,
  type ExtractionEvidence, type QrField,
} from "@/lib/extraction/evidence";
import { T } from "@/components/i18n/t";

/** أسماءُ الحقول كما يراها المستخدم */
const PROVENANCE_FIELD: Record<string, string> = {
  totalAmount: "الإجمالي",
  vatAmount: "الضريبة",
  subtotalAmount: "قبل الضريبة",
  sellerVatNumber: "الرقم الضريبي للبائع",
  invoiceDate: "التاريخ",
  invoiceNumber: "رقم الفاتورة",
  supplierNameAr: "اسم المورّد",
  supplierNameEn: "اسم المورّد",
};

function Mark({ field, evidence }: { field: QrField; evidence: ExtractionEvidence }) {
  if (evidence.agreements.includes(field)) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-normal text-ok">
        <T s="{0}يطابق ما قُرئ" a={[<CircleCheck key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></span>
    );
  }
  const d = evidence.disagreements.find((x) => x.field === field);
  if (d) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-normal text-warn">
        <T s="{0}المقروء: {1}" a={[<TriangleAlert key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />, <bdi key="1" dir="ltr" className="nums">{d.read}</bdi>]} /></span>
    );
  }
  return null;
}

export function ExtractionEvidencePanel({
  evidence,
  showAmounts,
  className = "",
}: {
  evidence: ExtractionEvidence | null;
  /** من لا يرى المبالغ لا يراها هنا أيضاً */
  showAmounts: boolean;
  className?: string;
}) {
  if (!evidence) return null;
  const qr = evidence.qr;
  const sources = Object.entries(evidence.provenance).filter(([key]) => PROVENANCE_FIELD[key]);
  const warnings = evidenceWarnings(evidence);
  if (!qr && sources.length === 0 && warnings.length === 0) return null;

  return (
    <div className={`rounded-xl border border-line bg-raised shadow-raised ${className}`}>
      <p className="flex items-center gap-2 border-b border-line-soft px-4 py-3 text-xs font-bold">
        <T s="{0}مقارنة بما قرأه النظام" a={[<QrCode key="0" className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />]} /></p>

      <div className="space-y-3 px-4 py-3 text-xs">
        {qr?.status === "FOUND" && (
          <div>
            <p className="leading-relaxed text-ink-soft">
              قُرئ رمز الفاتورة الضريبية (QR) من الملف نفسه، وقد أنشأه نظام المورّد لا قارئ المستندات:
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-muted">البائع</dt>
                <dd className="mt-0.5 truncate font-bold">
                  {qr.facts.sellerName ? <bdi>{qr.facts.sellerName}</bdi> : <span className="font-normal text-muted">غير معروف</span>}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">{QR_FIELD_LABEL.sellerVat}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 font-bold">
                  {qr.facts.sellerVatNumber
                    ? <bdi dir="ltr" className="nums">{qr.facts.sellerVatNumber}</bdi>
                    : <span className="font-normal text-muted">غير معروف</span>}
                  <Mark field="sellerVat" evidence={evidence} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">{QR_FIELD_LABEL.date}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 font-bold">
                  {qr.facts.date ? <bdi>{formatDay(qr.facts.date)}</bdi> : <span className="font-normal text-muted">غير معروف</span>}
                  <Mark field="date" evidence={evidence} />
                </dd>
              </div>
              {showAmounts && (
                <>
                  <div className="min-w-0">
                    <dt className="text-muted">{QR_FIELD_LABEL.total}</dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 font-bold">
                      {qr.facts.totalMinor !== null
                        ? <bdi dir="ltr" className="nums">{formatRiyalsDisplay(qr.facts.totalMinor)}</bdi>
                        : <span className="font-normal text-muted">غير معروف</span>}
                      <Mark field="total" evidence={evidence} />
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted">{QR_FIELD_LABEL.vat}</dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-x-2 font-bold">
                      {qr.facts.vatMinor !== null
                        ? <bdi dir="ltr" className="nums">{formatRiyalsDisplay(qr.facts.vatMinor)}</bdi>
                        : <span className="font-normal text-muted">غير معروف</span>}
                      <Mark field="vat" evidence={evidence} />
                    </dd>
                  </div>
                </>
              )}
            </dl>
          </div>
        )}
        {qr?.status === "NONE" && (
          <p className="leading-relaxed text-muted">
            لم يُعثر في الملف على رمز فاتورة ضريبية (QR)، وربما كان على الورقة ولم يظهر في الصورة. لا يمكن المقارنة به.
          </p>
        )}
        {qr?.status === "NOT_ZATCA" && (
          <p className="leading-relaxed text-muted">
            في الملف رمز (QR) ليس رمز فاتورة ضريبية، بل رابط أو رمز دفع. لا يمكن المقارنة به.
          </p>
        )}
        {qr?.status === "SKIPPED" && (
          <p className="leading-relaxed text-muted">لم يُفحص رمز الفاتورة (QR) في هذا الملف.</p>
        )}

        {sources.length > 0 && (
          <div>
            <p className="font-bold">بيانات لم يقرأها النظام من المستند، بل أُخذت من مصدر آخر:</p>
            <ul className="mt-1 space-y-0.5 text-ink-soft">
              {sources.map(([key, source]) => (
                <li key={key}>
                  {PROVENANCE_FIELD[key]}: <b>{SOURCE_LABEL[source]}</b>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted">إن خالف الورقة فعدّله في حقله، وما تكتبه أنت هو المعتمد.</p>
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="space-y-1.5">
            {warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2 leading-relaxed text-warn">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <span className="min-w-0 text-ink-soft">{w}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
