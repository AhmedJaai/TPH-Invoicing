/**
 * يصل المحرّك الجديد بما هو مخزَّن.
 *
 * `TxKind` لغة المحرّك، و`TxCategory` عمودٌ في القاعدة. وهذه الترجمة
 * بينهما — مكتوبةً في موضع واحد كي لا تتفرّق في المسارات.
 */
import type { TxCategory } from "./rules";
import type { TxKind } from "./taxonomy";

const TO_CATEGORY: Record<TxKind, TxCategory> = {
  SUPPLIER_PAYMENT: "SUPPLIER",
  POS_SETTLEMENT: "POS_SETTLEMENT",
  POS_FEE: "POS_FEE",
  POS_VAT: "POS_VAT",
  BANK_FEE: "BANK_FEE",
  INTERNAL_TRANSFER: "INTERNAL",
  OWNER_TRANSFER: "PERSONAL",
  SALARY: "SALARY",
  RENT: "RENT",
  UTILITY: "UTILITY",
  GOVERNMENT: "GOVERNMENT",
  ZAKAT: "ZAKAT",
  EXPENSE: "OTHER",
  UNKNOWN: "UNKNOWN",
};

export function toCategory(kind: TxKind): TxCategory {
  return TO_CATEGORY[kind];
}
