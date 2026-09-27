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
  | "INCONSISTENT"
  /** الكمّيّةُ لم تُقرأ — فلا سعرَ وحدةٍ يُبنى عليه، والكمّيّةُ «غير معروفة» لا ١ */
  | "QTY_UNREAD";

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

/**
 * كمّيّةُ السطر كما كُتبت — نصّاً عشريّاً بثلاث خاناتٍ على الأكثر، أو `null`.
 *
 * كانت `Number(x.replace(/[^\d.]/g, "")) || 1`: «٣» تُمحى فتصير ١، و«12 × 500»
 * تصير 12500، و«0» تصير ١. والكمّيّةُ غيرُ المقروءة ليست واحداً — تُخزَّن
 * «غير معروفة» فيقول الجردُ ذلك بدل أن يحسب كيساً واحداً.
 */
export function parseLineQuantity(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬/g, "");
  /* «2,5» فاصلةٌ عشريّة، و«1,200» فاصلُ آلاف */
  s = /^\s*\d+,\d{1,2}\s*$/.test(s) ? s.replace(",", ".") : s.replace(/(\d),(?=\d{3}\b)/g, "$1");
  const numbers = s.match(/-?\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length !== 1) return null;
  const n = Number(numbers[0]);
  if (!Number.isFinite(n) || n <= 0 || n >= 10_000_000) return null;
  const fixed = (Math.round(n * 1000) / 1000).toFixed(3);
  return fixed.replace(/\.?0+$/, "") || null;
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
    /*
      القسمة بأعدادٍ صحيحة (×١٠٠ ÷ ١١٥) ثمّ يُردّ فرقُ التقريب إلى أكبر
      بند — فيجمع الصافي إلى الصافي بالهللة. وكان كلّ بندٍ يُقرَّب وحده
      بعددٍ عشريّ فيفترق المجموع عن الصافي بهللات.
    */
    const pct = Math.round(VAT_RATE * 100);
    const shrink = (m: number) => Math.round((m * 100) / (100 + pct));
    const scaled = lines.map((l) => ({
      ...l,
      effectiveUnitMinor: shrink(l.effectiveUnitMinor),
      netTotalMinor: shrink(l.netTotalMinor),
      listUnitMinor: l.listUnitMinor === null ? null : shrink(l.listUnitMinor),
      discountMinor: shrink(l.discountMinor),
      basis: l.basis === "CONSISTENT" ? ("TOTAL_INCLUDES_VAT" as PricingBasis) : l.basis,
    }));
    const drift = subtotalMinor - scaled.reduce((s, l) => s + l.netTotalMinor, 0);
    if (drift !== 0 && Math.abs(drift) <= scaled.length) {
      let largest = 0;
      for (let k = 1; k < scaled.length; k++) {
        if (scaled[k].netTotalMinor > scaled[largest].netTotalMinor) largest = k;
      }
      scaled[largest] = { ...scaled[largest], netTotalMinor: scaled[largest].netTotalMinor + drift };
    }
    return { verdict: "WAS_VAT_INCLUSIVE", lines: scaled };
  }

  return { lines: [...lines], verdict: "UNVERIFIED" };
}
