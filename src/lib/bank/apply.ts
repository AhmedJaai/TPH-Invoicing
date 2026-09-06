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
  BANK_VAT: "BANK_VAT",
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
  /*
    الافتراض عند المجهول لا `undefined`.

    كانت تُرجع `undefined` لمفتاحٍ ليس من `TxKind`، فيمرّ صامتاً حتى
    يصل القاعدةَ فيولّد `category = ::tx_category` — خطأً في بناء
    الجملة لا في المنطق، ويصعب ردّه إلى سببه.
  */
  return TO_CATEGORY[kind] ?? "UNKNOWN";
}

/**
 * الترجمة العكسية: من عمود القاعدة إلى لغة المحرّك.
 *
 * وهذه هي التي نقصت. `counterparties.kind` عمودٌ من `TxCategory`،
 * وذاكرة المستفيدين كانت تُسنده إلى `TxKind` بـ`as` — فيُقرأ
 * «SUPPLIER» على أنّه نوعٌ في المحرّك وليس منه.
 *
 * والأثر لم يكن خطأً ظاهراً بل **صمتاً**: `PAYMENT_KINDS` لا تحوي
 * «SUPPLIER»، فكل جهةٍ تعلّمها النظام خرجت من مطابقة الفواتير أصلاً.
 * فصار التعلّم يُنقص المطابقات بدل أن يزيدها.
 *
 * والدرس: `as` تُسكت المترجم ولا تُصلح اختلافاً.
 */
const FROM_CATEGORY: Record<TxCategory, TxKind> = {
  SUPPLIER: "SUPPLIER_PAYMENT",
  SALARY: "SALARY",
  RENT: "RENT",
  ZAKAT: "ZAKAT",
  UTILITY: "UTILITY",
  GOVERNMENT: "GOVERNMENT",
  PERSONAL: "OWNER_TRANSFER",
  INTERNAL: "INTERNAL_TRANSFER",
  OTHER: "EXPENSE",
  UNKNOWN: "UNKNOWN",
  POS_SETTLEMENT: "POS_SETTLEMENT",
  POS_FEE: "POS_FEE",
  POS_VAT: "POS_VAT",
  BANK_FEE: "BANK_FEE",
  BANK_VAT: "BANK_VAT",
};

export function fromCategory(category: TxCategory): TxKind {
  return FROM_CATEGORY[category] ?? "UNKNOWN";
}
