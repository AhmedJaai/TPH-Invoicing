/**
 * كمّيّةُ الشراء وكلفةُ الوحدة — من الفواتير القائمة، لا من نموذجٍ ثانٍ.
 *
 * ── لماذا لا يُحسَب الفرقُ بالمبيعات وحدها ──
 *
 * افتتاحيٌّ ٥ كجم، ومشترياتٌ ٢٠، واستهلاكٌ متوقَّع ١٢ ← المتوقَّع ١٣.
 * ولو أُسقطت المشترياتُ لصار المتوقَّع «سالب ٧» والجردُ الفعليّ ١٠٫٥،
 * فيُعلَن «فائضٌ ١٧٫٥ كجم» — رقمٌ بلا معنى، وأسوأُ من لا رقم.
 *
 * ── والكمّيّة لا تُخمَّن من الريال ──
 *
 * «دفعتُ ٤٥٠ ريالاً لمحمصة» لا يقول كم كيلو. وقسمةُ المبلغ على آخر
 * سعرٍ معروف تُنتج كمّيّةً تبدو دقيقة وهي مخترَعة — ثمّ يُبنى عليها
 * فرقُ جردٍ يُحاسَب عليه أحد. **فما لم تُعرَف عبوتُه يُعلَن ويُستبعَد،
 * ويُعرَض عددُه ومبلغُه كي يُعرَف حجمُ ما خرج من الحساب.**
 */
import type { StoredUnit } from "@/lib/unit-conversion";
import { decimalToMilli, sameUnitFamily, toCanonical, MILLI } from "./units";
import { MILLI_MINOR } from "@/lib/money";

/** سطرُ فاتورةٍ بمواصفة عبوة صنفِ مورّده. */
export interface PurchaseLineInput {
  lineId: string;
  invoiceId: string;
  invoiceNumber: string;
  supplierName: string;
  /**
   * تاريخُ دخول البضاعة المعتمَد — الحقيقيّ إن وُجد، وإلّا تاريخُ
   * الفاتورة **نائباً مُعلَناً**.
   */
  invoiceDate: string;
  /** أهو تاريخُ استلامٍ حقيقيّ أم نائبٌ عنه؟ */
  receiptKnown?: boolean;
  description: string;
  productId: string | null;
  /** عددُ العبوات في السطر — نصٌّ عشريّ كما في `invoice_lines.qty`. */
  qty: string | null;
  lineTotalMinor: number;
  /** مواصفةُ العبوة من `supplier_products` — وثلاثتُها أو لا شيء. */
  packSize: string | null;
  contentUnit: StoredUnit | null;
  contentQuantity: string | null;
  /**
   * مصدرُ السطر: بندُ فاتورة، أو **كمّيّةٌ مستلَمة أدخلها إنسان**.
   *
   * والاثنان يمرّان بهذا الملفّ نفسِه — لا معادلةٌ ثانية للاستلام
   * اليدويّ. والفرقُ الوحيد من أين تُعرَف الكمّيّة: من مواصفة العبوة
   * في الفاتورة، ومن الرقم الذي كتبه صاحبُ المقهى في الاستلام.
   */
  source?: "INVOICE" | "MANUAL_RECEIPT";
  /** للاستلام اليدويّ: الكمّيّةُ بالمِلّي من `receivedUnit` كما أُدخلت. */
  receivedMilli?: number | null;
  receivedUnit?: StoredUnit | null;
  /**
   * أتُعرَف كلفةُ هذا السطر؟ — والافتراضُ نعم (بندُ فاتورةٍ مبلغُه
   * مدفوع). والاستلامُ بلا كلفة لا يدخل **مقامَ** متوسّط الكلفة، وإلّا
   * خفّض كلفةَ الوحدة بكمّيّةٍ لم يُدفَع عنها شيءٌ معروف.
   */
  costKnown?: boolean;
}

export type PurchaseGapReason =
  | "UNLINKED_PRODUCT"
  | "NO_PACK_SPEC"
  | "MISSING_QUANTITY"
  | "UNIT_FAMILY_MISMATCH";

export const PURCHASE_GAP_LABEL: Record<PurchaseGapReason, string> = {
  UNLINKED_PRODUCT: "بندٌ غير مربوطٍ بصنفٍ معياريّ",
  NO_PACK_SPEC: "مواصفةُ عبوة المورّد غير معروفة — فلا تُعرَف الكمّيّة",
  MISSING_QUANTITY: "الكمّيّة غير مقروءةٍ في الفاتورة",
  UNIT_FAMILY_MISMATCH: "وحدةُ العبوة لا تُحوَّل إلى وحدة الصنف — وزنٌ وحجم",
};

export type PurchaseQuantity =
  | { known: true; canonicalMilli: number }
  | { known: false; reason: PurchaseGapReason };

/**
 * كمّيّةُ السطر بالوحدة المعياريّة.
 *
 * ```
 *   عددُ العبوات × حجمُ العبوة × كمّيّةُ ما في الواحدة  →  وحدةُ المحتوى
 * ```
 *
 * «سطرٌ فيه كرتونان، والكرتون ١٢ × ١ لتر» = ‏٢٤ لتراً. ثمّ يُحوَّل
 * إلى عائلة وحدةِ الصنف، وما لم يصحّ تحويلُه يُعلَن — ولا يُمرَّر
 * كما هو، فذاك بالضبط ما يُنتج «٢٤ كيلو» من أربعةٍ وعشرين لتراً.
 */
export function purchaseQuantity(
  line: PurchaseLineInput,
  productBaseUnit: StoredUnit,
): PurchaseQuantity {
  if (!line.productId) return { known: false, reason: "UNLINKED_PRODUCT" };

  /*
    ── الاستلامُ اليدويّ: الكمّيّةُ مكتوبةٌ لا مشتقّة ──

    كتبها صاحبُ المقهى بوحدته، وتحقّق الخادمُ عند الحفظ من عائلتها.
    ويُعاد الفحصُ هنا لأنّ وحدةَ الصنف قد تتغيّر بعد الحفظ — ووزنٌ
    لا يصير حجماً بمرور الوقت.
  */
  if (line.source === "MANUAL_RECEIPT") {
    if (line.receivedMilli == null || line.receivedUnit == null || line.receivedMilli <= 0) {
      return { known: false, reason: "MISSING_QUANTITY" };
    }
    if (!sameUnitFamily(line.receivedUnit, productBaseUnit)) {
      return { known: false, reason: "UNIT_FAMILY_MISMATCH" };
    }
    return { known: true, canonicalMilli: toCanonical(line.receivedMilli, line.receivedUnit) };
  }

  const qtyMilli = decimalToMilli(line.qty);
  if (qtyMilli === null) return { known: false, reason: "MISSING_QUANTITY" };

  const packMilli = decimalToMilli(line.packSize);
  const contentMilli = decimalToMilli(line.contentQuantity);

  /* المجهول لا يُحوَّل ولا يُفترَض واحداً — نصّ `unit-conversion.ts` */
  if (packMilli === null || contentMilli === null || line.contentUnit === null) {
    return { known: false, reason: "NO_PACK_SPEC" };
  }
  if (packMilli <= 0 || contentMilli <= 0) return { known: false, reason: "NO_PACK_SPEC" };

  if (!sameUnitFamily(line.contentUnit, productBaseUnit)) {
    return { known: false, reason: "UNIT_FAMILY_MISMATCH" };
  }

  /* ثلاثةُ أعدادٍ بالمِلّي مضروبةٌ ببعضها = مِلّي³، فيُقسَم على ‏١٠٦ */
  const inContentUnitMilli = (qtyMilli * packMilli * contentMilli) / (MILLI * MILLI);
  return { known: true, canonicalMilli: Math.round(toCanonical(inContentUnitMilli, line.contentUnit)) };
}

export interface PurchaseGap {
  lineId: string;
  invoiceNumber: string;
  supplierName: string;
  description: string;
  productId: string | null;
  lineTotalMinor: number;
  reason: PurchaseGapReason;
}

export interface ProductPurchases {
  productId: string;
  canonicalMilli: number;
  /** ما دُفع في الأسطر التي عُرفت كمّيّتُها — وحدها تصلح أساساً للكلفة. */
  knownCostMinor: number;
  /**
   * الكمّيّةُ التي عُرفت كلفتُها — **مقامُ** المتوسّط.
   *
   * استلامٌ يدويٌّ بلا كلفة يزيد الكمّيّة ولا يزيد المبلغ؛ فلو دخل
   * المقامَ لقال المتوسّطُ إنّ الكيلو أرخصُ ممّا دُفع فيه.
   */
  costedMilli: number;
  /** وما دخل منها بإدخالٍ يدويّ — يُعرَض مصدرُ الكمّيّة لا الكمّيّةُ وحدها. */
  manualMilli: number;
  lines: number;
  invoiceLineIds: string[];
  /** معرّفاتُ الاستلامات اليدويّة — تُحفَظ في لقطة الجرد المقفَل. */
  receiptIds: string[];
}

export interface PurchaseSummary {
  byProduct: Map<string, ProductPurchases>;
  gaps: PurchaseGap[];
  /** ما خرج من الحساب — عدداً ومبلغاً، فيُعرَف حجمُه لا وجودُه فقط. */
  gapTotals: { lines: number; totalMinor: number };
  totalLines: number;
}

/** يجمع مشترياتِ الفترة لكلّ صنف، ويفصل ما تعذّرت معرفةُ كمّيّته. */
export function summarisePurchases(
  lines: readonly PurchaseLineInput[],
  baseUnitOf: (productId: string) => StoredUnit | null,
): PurchaseSummary {
  const byProduct = new Map<string, ProductPurchases>();
  const gaps: PurchaseGap[] = [];

  const gap = (line: PurchaseLineInput, reason: PurchaseGapReason) => {
    gaps.push({
      lineId: line.lineId,
      invoiceNumber: line.invoiceNumber,
      supplierName: line.supplierName,
      description: line.description,
      productId: line.productId,
      lineTotalMinor: line.lineTotalMinor,
      reason,
    });
  };

  for (const line of lines) {
    if (!line.productId) {
      gap(line, "UNLINKED_PRODUCT");
      continue;
    }
    const base = baseUnitOf(line.productId);
    if (!base) {
      gap(line, "UNLINKED_PRODUCT");
      continue;
    }

    const q = purchaseQuantity(line, base);
    if (!q.known) {
      gap(line, q.reason);
      continue;
    }

    let acc = byProduct.get(line.productId);
    if (!acc) {
      acc = {
        productId: line.productId, canonicalMilli: 0, knownCostMinor: 0, costedMilli: 0,
        manualMilli: 0, lines: 0, invoiceLineIds: [], receiptIds: [],
      };
      byProduct.set(line.productId, acc);
    }
    acc.canonicalMilli += q.canonicalMilli;
    if (line.costKnown !== false) {
      acc.knownCostMinor += line.lineTotalMinor;
      acc.costedMilli += q.canonicalMilli;
    }
    acc.lines++;
    if (line.source === "MANUAL_RECEIPT") {
      acc.manualMilli += q.canonicalMilli;
      acc.receiptIds.push(line.lineId);
    } else {
      acc.invoiceLineIds.push(line.lineId);
    }
  }

  return {
    byProduct,
    gaps,
    gapTotals: {
      lines: gaps.length,
      totalMinor: gaps.reduce((s, g) => s + g.lineTotalMinor, 0),
    },
    totalLines: lines.length,
  };
}

/**
 * معدَّلُ كلفةِ وحدةِ الأساس — **بمِلّي‑الهللة**، متوسّطاً مرجَّحاً
 * لمشتريات الفترة.
 *
 * ── ولماذا لا تُقرَّب هنا ──
 *
 * كان يُقرَّب إلى هللةٍ صحيحة ثمّ يُضرَب في الكمّيّة. وذلك يصحّ في
 * الكيلو (‏٩٦٫٢٥ ريالاً = ‏٩٦٢٥ هللة بالضبط) ويكسر في العدّ: كرتونُ
 * المصّاصات ٨٥ ريالاً لأربعة آلاف = ‏٢٫١٢٥ هللة للمصّاصة، فيُقرَّب
 * إلى هللتين — **وتضيع ستّةٌ في المئة من كلفة كلّ مصّاصة**، خمسةَ
 * ريالاتٍ في الكرتون الواحد.
 *
 * فالمعدَّلُ يبقى بمِلّي‑الهللة، والتقريبُ عند آخر ضربٍ وحده.
 *
 * وترجع `null` حين لا مشترياتٍ صالحة — **لا صفراً**. فصفرُ الكلفة
 * يجعل كلفةَ الفرق صفراً، فيُقرأ «فرقٌ بلا أثرٍ ماليّ» وهو فرقٌ لا
 * نعرف كلفتَه.
 */
export function unitCostMilliMinor(
  purchases: ProductPurchases | undefined,
  baseUnit: StoredUnit,
  fallbackMilliMinor: number | null,
): number | null {
  if (!purchases || purchases.costedMilli <= 0 || purchases.knownCostMinor <= 0) {
    return fallbackMilliMinor;
  }
  /* الكمّيّة المعياريّة مِلّي‑صغرى؛ والمعدَّل يحتاج قسمتها على وحدةِ الأساس */
  const baseUnits = quantityInBaseUnits(purchases.costedMilli, baseUnit);
  if (baseUnits <= 0) return fallbackMilliMinor;
  return Math.round((purchases.knownCostMinor * MILLI_MINOR) / baseUnits);
}

/** الكمّيّة المعياريّة معبَّرٌ عنها بعددِ وحداتِ الأساس — للقسمة والضرب بالكلفة. */
export function quantityInBaseUnits(canonicalMilli: number, baseUnit: StoredUnit): number {
  const perBaseUnit = toCanonical(MILLI, baseUnit);
  return canonicalMilli / perBaseUnit;
}

/**
 * كلفةُ الفرق بالهللات — عددٌ صحيح، بتقريبٍ **واحد** في آخر الطريق.
 *
 * وترجع `null` حين تُجهَل الكلفة أو الفرق، فلا يُعرَض صفرٌ باسم
 * التكلفة.
 */
export function varianceCostMinor(
  varianceCanonicalMilli: number | null,
  unitRateMilliMinor: number | null,
  baseUnit: StoredUnit,
): number | null {
  if (varianceCanonicalMilli === null || unitRateMilliMinor === null) return null;
  const baseUnits = quantityInBaseUnits(varianceCanonicalMilli, baseUnit);
  return Math.round((baseUnits * unitRateMilliMinor) / MILLI_MINOR);
}
