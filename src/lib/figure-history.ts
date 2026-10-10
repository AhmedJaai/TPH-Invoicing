/**
 * «لماذا هذا الرقم؟» — آخرُ ما حرّك رقماً رئيسيّاً، من سجلّ التدقيق القائم.
 *
 * `LiveMoney` يومض حين يتغيّر الرقم ولا يقول السبب. فلكلّ رقمٍ قائمةُ الأفعال
 * التي تحرّكه (قيدُ فاتورة، سداد، تصحيح، مطابقة)، ومن السجلّ تُقرأ آخرُها بتاريخها
 * وفاعلها ورابطها. **لا حسابَ جديد ولا مبلغَ مشتقّ**: ما حمله السجلُّ من مبلغٍ يُعرَض،
 * وما لم يحمله لا يُخترَع له.
 */
import { actionLabel } from "./audit-labels";
import { invoiceHref } from "./invoice-profile";
import { txHref } from "./inspector";

export type FigureId = "owed";

/** الأفعالُ التي تغيّر «عليك للمورّدين»: ما يزيد المفتوحَ على الفواتير وما يُنقصه. */
export const FIGURE_ACTIONS: Record<FigureId, readonly string[]> = {
  owed: [
    "DOCUMENT_ARCHIVED", "DOCUMENT_REREAD", "DOCUMENT_RECORDED_BY_HAND", "DOCUMENT_REJECTED", "STATEMENT_INVOICES_RECORDED",
    "INVOICE_FIELDS_CORRECTED", "INVOICE_REPLACED",
    "INVOICES_MARKED_PAID", "INVOICE_PAID_BY_OWNER", "PAYMENT_RECORDED", "PAYMENT_VOIDED", "PAYMENT_REALLOCATED",
    "PAYMENT_CREDIT_NOTE_RECORDED", "PAYMENT_ECHO_MERGED", "SUPPLIER_CREDIT_APPLIED", "MATCH_CONFIRMED", "MATCH_UNDONE",
  ],
};

export function isFigureId(v: string | null | undefined): v is FigureId {
  return v === "owed";
}

export interface AuditRow {
  action: string;
  entityType: string;
  entityId: string;
  after: unknown;
  actorId: string | null;
  actorName: string | null;
}

export interface Mover {
  label: string;
  /** «أنت» أو اسمُ الفاعل أو «النظام» — وما قاله السجلُّ آليّاً يُوسَم. */
  who: string;
  automatic: boolean;
  /** ما يُعرّف القيد: ملفٌّ أو أرقامُ فواتير — إن حمله السجلّ. */
  detail: string | null;
  /** مبلغٌ حمله السجلُّ بالهللات — `null` لم يحمله (لا يُشتقّ). */
  amountMinor: number | null;
  href: string | null;
}

const AMOUNT_KEYS = ["المبلغ_بالهللات", "سداد_المالك_بالهللات", "المبلغ بالهللات", "amountMinor"] as const;
const DETAIL_KEYS = ["الملف", "الفاتورة", "الفواتير", "المورّد", "رقم_الفاتورة"] as const;

function field(after: unknown, keys: readonly string[]): unknown {
  if (typeof after !== "object" || after === null) return undefined;
  for (const [k, v] of Object.entries(after)) if (keys.includes(k) && v !== null && v !== "") return v;
  return undefined;
}

export function describeMover(row: AuditRow, viewerId: string): Mover {
  const amount = field(row.after, AMOUNT_KEYS);
  const detail = field(row.after, DETAIL_KEYS);
  const reason = field(row.after, ["السبب", "نوع"]);
  /* الاستدراكُ يكتب باسم من فُتحت الصفحةُ عنده — فيُعرَف الآليُّ من سببه لا من فاعله */
  const automatic = row.actorId === null || (typeof reason === "string" && /آلي|الأرشفة الآليّة|القراءة المحفوظة/.test(reason));
  return {
    label: actionLabel(row.action),
    who: automatic ? "النظام" : row.actorId === viewerId ? "أنت" : row.actorName ?? "مستخدمٌ آخر",
    automatic,
    detail: Array.isArray(detail)
      ? detail.filter((d): d is string => typeof d === "string").slice(0, 4).join("، ") || null
      : typeof detail === "string" ? detail.slice(0, 80) : null,
    amountMinor: typeof amount === "number" && Number.isSafeInteger(amount) ? amount : null,
    /* «وسمُ فواتير مسدَّدة» يُقيَّد بمعرّف المورّد لا الفاتورة — فلا رابطَ يُخترَع له */
    href: row.entityType === "invoice" && row.action !== "INVOICES_MARKED_PAID" ? invoiceHref(row.entityId)
      : row.entityType === "document" ? `/documents/file/${encodeURIComponent(row.entityId)}`
      : row.entityType === "bank_transaction" ? txHref(encodeURIComponent(row.entityId))
      : null,
  };
}
