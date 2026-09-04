/**
 * السعر الفعلي للوحدة.
 *
 * المشكلة التي يعالجها هذا الملف حقيقية ورأيناها في فواتير أفال: النموذج
 * ينسخ **سعر القائمة** في خانة سعر الوحدة، وينسخ **الإجمالي بعد الخصم** في
 * خانة الإجمالي. فتصير الفاتورة تقول: عشر وحدات، سعر الوحدة ١٤٠، والإجمالي
 * ٨٨٥٫٥٠. والسعر الذي دفعناه فعلاً ٨٨٫٥٥ لا ١٤٠.
 *
 * وأثر الخطأ ليس تجميلياً: تحليل الأسعار كان يقول «ارتفع من ٧٧ إلى ١٤٠»
 * وهو لم يرتفع أصلاً.
 *
 * والعكس يقع أيضاً: زاكوباك تكتب سعر الوحدة صافياً والإجمالي شاملاً الضريبة،
 * فيبدو الإجمالي أكبر من حاصل الضرب بنسبة الضريبة تماماً.
 *
 * القاعدة: ما دفعناه فعلاً هو الحقيقة، وسعر القائمة يُحفظ للمقارنة لا للتحليل.
 */
import { VAT_RATE } from "@/config/drive";

export type PricingBasis =
  /** الضرب يستقيم — لا خصم ولا التباس */
  | "CONSISTENT"
  /** الإجمالي أقل من حاصل الضرب: خصم */
  | "DISCOUNTED"
  /** الإجمالي = حاصل الضرب × (١ + الضريبة) */
  | "TOTAL_INCLUDES_VAT"
  /** لم يُقرأ إلا أحدهما */
  | "DERIVED"
  /** تعارض لا يُفسَّر بخصم ولا بضريبة */
  | "INCONSISTENT";

export interface LinePricingInput {
  quantity: number;
  /** سعر الوحدة كما قرأه النموذج — قد يكون سعر القائمة */
  unitPriceMinor: number | null;
  /** إجمالي السطر كما قرأه النموذج */
  lineTotalMinor: number | null;
}

export interface LinePricing {
  /** ما دفعناه فعلاً للوحدة — عليه وحده يقوم تتبّع الأسعار */
  effectiveUnitMinor: number;
  /** إجمالي السطر صافياً قبل الضريبة */
  netTotalMinor: number;
  /** سعر القائمة إن خالف الفعلي */
  listUnitMinor: number | null;
  discountMinor: number;
  basis: PricingBasis;
}

/** هامش تسامح نسبي — التقريب في الفواتير يعطي فروقاً بالهللات. */
const REL = 0.01;

function near(a: number, b: number, rel = REL): boolean {
  if (b === 0) return a === 0;
  return Math.abs(a - b) / Math.abs(b) <= rel;
}

export function resolveLinePricing(input: LinePricingInput): LinePricing | null {
  const qty = input.quantity > 0 ? input.quantity : 1;
  const unit = input.unitPriceMinor;
  const total = input.lineTotalMinor;

  // السطر بلا سعر ولا مبلغ لا يُسجَّل — صفرٌ مخترع يفسد كل متوسط بعده
  if (unit === null && total === null) return null;

  if (unit !== null && total === null) {
    const net = Math.round(unit * qty);
    return {
      effectiveUnitMinor: unit, netTotalMinor: net,
      listUnitMinor: null, discountMinor: 0, basis: "DERIVED",
    };
  }

  if (unit === null && total !== null) {
    return {
      effectiveUnitMinor: Math.round(total / qty), netTotalMinor: total,
      listUnitMinor: null, discountMinor: 0, basis: "DERIVED",
    };
  }

  const expected = unit! * qty;

  if (near(total!, expected)) {
    return {
      effectiveUnitMinor: unit!, netTotalMinor: total!,
      listUnitMinor: null, discountMinor: 0, basis: "CONSISTENT",
    };
  }

  // الإجمالي شامل الضريبة وسعر الوحدة صافٍ — الصافي هو الصحيح
  if (near(total!, expected * (1 + VAT_RATE))) {
    return {
      effectiveUnitMinor: unit!, netTotalMinor: Math.round(expected),
      listUnitMinor: null, discountMinor: 0, basis: "TOTAL_INCLUDES_VAT",
    };
  }

  if (total! < expected) {
    // خصم: ما دفعناه هو الإجمالي، وسعر القائمة يُحفظ للمقارنة
    return {
      effectiveUnitMinor: Math.round(total! / qty),
      netTotalMinor: total!,
      listUnitMinor: unit!,
      discountMinor: Math.round(expected - total!),
      basis: "DISCOUNTED",
    };
  }

  /*
   * الإجمالي أكبر من حاصل الضرب بما لا تفسّره الضريبة.
   * الأرجح أنّ الكمية أو السعر قُرئ خطأً. نأخذ الإجمالي — فهو ما دُفع —
   * ونسم السطر بأنّه متعارض كي يُراجَع لا كي يُبتلَع.
   */
  return {
    effectiveUnitMinor: Math.round(total! / qty),
    netTotalMinor: total!,
    listUnitMinor: unit!,
    discountMinor: 0,
    basis: "INCONSISTENT",
  };
}

/* ─────────────────── تسوية البنود بصافي الفاتورة ─────────────────── */

/**
 * المرساة: صافي الفاتورة نفسه.
 *
 * سطر الفاتورة وحده لا يكفي للحكم: قد يكون إجماليه صافياً وقد يكون شاملاً
 * الضريبة، والرقمان كلاهما «معقول» في معزل. لكن مجموع البنود يجب أن يساوي
 * صافي الفاتورة — فإن ساواه مضروباً في ١٫١٥ فالبنود شاملة الضريبة كلّها.
 *
 * وهذا ليس فرضاً نظرياً: في فواتير أفال جاءت النسبة إمّا ١٫٠٠٠٠ أو ١٫١٥٠٠
 * بالضبط ولا شيء بينهما، فأنتج الخلط «ارتفاع أسعار ١٥٪» في ثلاثة أصناف
 * وهي لم ترتفع هللةً واحدة.
 */
export interface LineToReconcile {
  effectiveUnitMinor: number;
  netTotalMinor: number;
  listUnitMinor: number | null;
  discountMinor: number;
  basis: PricingBasis;
}

export type InvoiceLinesVerdict = "NET" | "WAS_VAT_INCLUSIVE" | "UNVERIFIED";

export interface ReconciledLines<T extends LineToReconcile> {
  lines: T[];
  verdict: InvoiceLinesVerdict;
}

export function reconcileInvoiceLines<T extends LineToReconcile>(
  lines: readonly T[],
  subtotalMinor: number | null | undefined,
): ReconciledLines<T> {
  if (lines.length === 0) return { lines: [], verdict: "UNVERIFIED" };

  // بلا صافٍ معلوم لا مرساة — تُترك كما هي ولا يُدّعى تحقّق لم يقع
  if (!subtotalMinor || subtotalMinor <= 0) {
    return { lines: [...lines], verdict: "UNVERIFIED" };
  }

  const sum = lines.reduce((s, l) => s + l.netTotalMinor, 0);

  if (near(sum, subtotalMinor)) return { lines: [...lines], verdict: "NET" };

  if (near(sum, subtotalMinor * (1 + VAT_RATE))) {
    const factor = 1 + VAT_RATE;
    return {
      verdict: "WAS_VAT_INCLUSIVE",
      lines: lines.map((l) => ({
        ...l,
        effectiveUnitMinor: Math.round(l.effectiveUnitMinor / factor),
        netTotalMinor: Math.round(l.netTotalMinor / factor),
        listUnitMinor: l.listUnitMinor === null ? null : Math.round(l.listUnitMinor / factor),
        discountMinor: Math.round(l.discountMinor / factor),
        basis: l.basis === "CONSISTENT" ? ("TOTAL_INCLUDES_VAT" as PricingBasis) : l.basis,
      })),
    };
  }

  return { lines: [...lines], verdict: "UNVERIFIED" };
}
