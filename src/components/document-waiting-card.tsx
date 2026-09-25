import Link from "next/link";
import { CircleAlert, CircleCheck, ExternalLink, PenLine, TriangleAlert } from "lucide-react";
import { Money } from "./money";
import { Monogram } from "./ui";
import { buttonClass } from "./ui-tokens";
import { RejectDocument } from "./reject-document";
import { ConfirmDocument } from "./confirm-document";
import { invoiceHref } from "@/lib/invoice-profile";
import { formatDay, formatMonth } from "@/lib/riyadh-time";

/** رابط الملف في الدرايف — المعرّف محفوظ لكل مستند منذ الأرشفة. */
const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/**
 * بطاقةُ مستندٍ ينتظر: من، وكم، ولماذا لم يدخل وحده، وما قرأه النموذج —
 * ثمّ الفعلُ بجانب السبب.
 *
 * «افتح الورقة» قبل «اعتمد» عمداً: الاعتمادُ شهادةٌ بأنّ ما قرأه النموذج
 * يطابق الورقة، ولا تُعطى شهادةٌ بلا نظر.
 */
export function WaitingCard({
  row: r,
  why,
  kindLabel,
  showAmounts,
  canDecide,
}: {
  row: {
    id: string;
    fileName: string;
    driveFileId: string | null;
    kind: string;
    status: string;
    periodMonth: string | null;
    textSource: string | null;
    supplierName: string | null;
    invoiceId: string | null;
    invoiceNumber: string | null;
    invoiceDate: Date | null;
    subtotalMinor: number | null;
    vatMinor: number | null;
    totalMinor: number | null;
  };
  why: { tone: "warn" | "ok" | "muted"; lines: string[] };
  kindLabel: string;
  showAmounts: boolean;
  canDecide: boolean;
}) {
  const WhyIcon = why.tone === "ok" ? CircleCheck : why.tone === "warn" ? TriangleAlert : CircleAlert;
  const whyCls = why.tone === "ok" ? "text-ok" : why.tone === "warn" ? "text-warn" : "text-ink-soft";
  const unknown = <span className="font-normal text-muted">غير معروف</span>;

  return (
    <li className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 pt-4 sm:px-5">
        <Monogram name={r.supplierName ?? "؟"} className="h-10 w-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{r.supplierName ?? "مورّدٌ لم يُعرَف"}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>{kindLabel}</span>
            {r.periodMonth && <><span aria-hidden>·</span><span>{formatMonth(r.periodMonth)}</span></>}
            {r.textSource && (
              <>
                <span aria-hidden>·</span>
                <span>{r.textSource === "TEXT" ? "قُرئ من نصّ الملفّ" : "قُرئ من صورة — ظنّاً"}</span>
              </>
            )}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted" dir="ltr" title={r.fileName}>{r.fileName}</p>
        </div>
        {showAmounts && (
          <div className="text-end">
            <p className="text-[11px] text-muted">الإجمالي</p>
            <p className="text-lg font-bold leading-tight">
              {r.totalMinor !== null ? <Money minor={r.totalMinor} /> : <span className="text-sm text-muted">غير معروف</span>}
            </p>
          </div>
        )}
      </div>

      {/* ── لماذا ينتظر ── */}
      <div className={`mx-4 mt-3 flex items-start gap-2 rounded-lg bg-sunken px-3 py-2 text-xs leading-relaxed sm:mx-5 ${whyCls}`}>
        <WhyIcon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <div className="min-w-0">
          <p className="font-bold">{why.tone === "ok" ? "جاهز" : why.tone === "warn" ? "لم يدخل وحده" : "يحتاج نظرك"}</p>
          <ul className="text-ink-soft">
            {why.lines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      </div>

      {/* ── ما قرأه النموذج — يُقارَن بالورقة ── */}
      {r.invoiceId && showAmounts && (
        <dl className="mx-4 mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:mx-5 sm:grid-cols-5">
          <Read label="رقم الفاتورة">{r.invoiceNumber ? <bdi className="nums">{r.invoiceNumber}</bdi> : unknown}</Read>
          <Read label="التاريخ">{r.invoiceDate ? formatDay(r.invoiceDate) : unknown}</Read>
          <Read label="قبل الضريبة">{r.subtotalMinor !== null ? <Money minor={r.subtotalMinor} /> : unknown}</Read>
          <Read label="الضريبة">{r.vatMinor !== null ? <Money minor={r.vatMinor} /> : unknown}</Read>
          <Read label="الإجمالي">{r.totalMinor !== null ? <Money minor={r.totalMinor} /> : unknown}</Read>
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft bg-sunken/40 px-4 py-3 sm:px-5">
        {r.driveFileId && (
          <a href={driveUrl(r.driveFileId)} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            افتح الورقة
          </a>
        )}
        {r.invoiceId && showAmounts && (
          <Link href={invoiceHref(r.invoiceId, "tax")} className={buttonClass("quiet", "sm")}>
            <PenLine className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            صحّح حقلاً
          </Link>
        )}
        <span className="flex-1" />
        {canDecide && (showAmounts || r.totalMinor === null) && <RejectDocument documentId={r.id} />}
        {canDecide && showAmounts && r.status === "NEEDS_REVIEW" && <ConfirmDocument documentId={r.id} variant="primary" />}
        {!canDecide && <span className="text-[11px] text-muted">الحسمُ لمن يرفع المستندات ويعتمدها.</span>}
      </div>
    </li>
  );
}

function Read({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-bold">{children}</dd>
    </div>
  );
}
