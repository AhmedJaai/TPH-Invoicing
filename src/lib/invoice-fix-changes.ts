/**
 * «قبل ← بعد» لتصحيح الفاتورة — ما تغيّر بعينه يُقال، لا «حُفظ التصحيح» وحدها.
 *
 * بعد الحفظ تتبدّل أرقامٌ على الصفحة (الإجماليّ، ما بقي، حالُ الضريبة، رصيدُ
 * المورّد) ولا يُعرف أيُّها من كم إلى كم. والقيمُ السابقة معلومةٌ للنموذج، فيُسرَد
 * الفرق حقلاً حقلاً. المبالغُ تُقارَن **هللاتٍ** لا نصوصاً: «1150» و«1,150.00»
 * واحد، وما لا يُقرأ يُعرَض كما كُتب.
 */
import { formatRiyalsDisplay, parseRiyals } from "./money";

export interface FixFields {
  invoiceNumber: string;
  sellerVat: string;
  buyerVat: string;
  subtotal: string;
  vat: string;
  total: string;
  discount: string;
  charges: string;
  invoiceDate: string;
  supplierId: string;
}

const LABEL: Record<keyof FixFields, string> = {
  invoiceNumber: "رقم الفاتورة",
  sellerVat: "الرقم الضريبيّ للبائع",
  buyerVat: "الرقم الضريبيّ للمشتري",
  subtotal: "قبل الضريبة",
  vat: "الضريبة",
  total: "الإجماليّ",
  discount: "الخصم",
  charges: "الرسوم",
  invoiceDate: "التاريخ",
  supplierId: "المورّد",
};

const MONEY: readonly (keyof FixFields)[] = ["subtotal", "vat", "total", "discount", "charges"];
const ORDER: readonly (keyof FixFields)[] = [
  "supplierId", "invoiceNumber", "invoiceDate", "subtotal", "vat", "total", "discount", "charges", "sellerVat", "buyerVat",
];

export interface FieldChange {
  field: keyof FixFields;
  label: string;
  before: string;
  after: string;
}

export function fixChanges(
  before: FixFields,
  after: FixFields,
  supplierName: (id: string) => string | null = () => null,
): FieldChange[] {
  const show = (field: keyof FixFields, value: string): string => {
    const v = value.trim();
    if (v === "") return "فارغ";
    if (field === "supplierId") return supplierName(v) ?? "مورّدٌ آخر";
    if (MONEY.includes(field)) {
      const minor = parseRiyals(v);
      return minor === null ? v : formatRiyalsDisplay(minor);
    }
    return v;
  };
  const same = (field: keyof FixFields): boolean => {
    const a = before[field].trim();
    const b = after[field].trim();
    if (a === b) return true;
    if (!MONEY.includes(field)) return false;
    const am = a === "" ? null : parseRiyals(a);
    const bm = b === "" ? null : parseRiyals(b);
    /* الفارغُ ليس صفراً: «لا خصم» غيرُ «خصمٌ 0.00» في القيد */
    return a !== "" && b !== "" && am !== null && am === bm;
  };
  return ORDER.filter((f) => !same(f)).map((f) => ({ field: f, label: LABEL[f], before: show(f, before[f]), after: show(f, after[f]) }));
}

/** سطرٌ واحد يُقرأ في إشعار: «الإجماليّ 1,150.00 ← 1,050.00 · الضريبة …». */
export function changesLine(changes: readonly FieldChange[]): string {
  return changes.map((c) => `${c.label}: ${c.before} ← ${c.after}`).join(" · ");
}
