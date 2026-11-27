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
import { VAT_PERCENT, grossOfNetExact, netInsideGross } from "./vat";
import { latinDigits } from "./digits";
import { parseRiyals } from "./money";

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
  | "QTY_UNREAD"
  /** قُرئ عددُ الحبّات في الكرتون مكانَ الكمّيّة، فالكمّيّةُ من المجموع ÷ سعر الحبّة (`packQuantity`) */
  | "PACK_QTY";

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
  let s = latinDigits(raw)
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
  if (near(total!, grossOfNetExact(expected))) {
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

  if (near(sum, grossOfNetExact(subtotalMinor))) {
    /*
      القسمة بأعدادٍ صحيحة (×١٠٠ ÷ ١١٥) ثمّ يُردّ فرقُ التقريب إلى أكبر
      بند — فيجمع الصافي إلى الصافي بالهللة. وكان كلّ بندٍ يُقرَّب وحده
      بعددٍ عشريّ فيفترق المجموع عن الصافي بهللات.
    */
    const shrink = netInsideGross;
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

/* ─────────────────── الكرتونُ والحبّة ─────────────────── */

/**
 * أرقامُ خانة سعر الوحدة. رقمٌ واحد سعرٌ واحد؛ و«54.60 / 9.10» سعران — للكرتون وللحبّة —
 * يُقبلان إن كان الأكبرُ مضاعفاً صحيحاً للأصغر (حبّاتُ الكرتون). وما سوى ذلك لا يُقرأ.
 */
export function unitPriceCandidates(raw: string | null | undefined): number[] {
  if (!raw || !raw.trim()) return [];
  const one = parseRiyals(raw);
  if (one !== null) return [one];
  const parts = latinDigits(raw).replace(/٫/g, ".").match(/\d[\d,٬]*(?:\.\d{1,3})?/g) ?? [];
  if (parts.length !== 2) return [];
  const prices = parts.map((p) => parseRiyals(p));
  if (prices.some((p) => p === null || p <= 0)) return [];
  const [hi, lo] = (prices as number[]).sort((a, b) => b - a);
  return hi % lo === 0 && hi / lo >= 2 ? [hi, lo] : [];
}

/** كم حبّةً بسعر `price` يساويها المجموع — صافياً أو شاملاً الضريبة — بهللتين؟ `null` إن لم يكن عدداً صحيحاً. */
function wholeUnits(totalMinor: number, priceMinor: number, grossOnly = false): number | null {
  if (priceMinor <= 0 || totalMinor <= 0) return null;
  const net = Math.round(totalMinor / priceMinor);
  if (!grossOnly && net >= 1 && Math.abs(net * priceMinor - totalMinor) <= 2) return net;
  /* ‎|n×السعر×(١٠٠+الضريبة) − المجموع×١٠٠| ≤ ٢٠٠ — بلا عددٍ عشريّ */
  const grossFactor = 100 + VAT_PERCENT;
  const gross = Math.round((totalMinor * 100) / (priceMinor * grossFactor));
  if (gross >= 1 && Math.abs(gross * priceMinor * grossFactor - totalMinor * 100) <= 200) return gross;
  return null;
}

/**
 * الكمّيّةُ الحقيقيّة حين قُرئ عددُ حبّات الكرتون مكانها.
 *
 * فاتورةُ نادك تطبع للبند «حبّات الكرتون: 6» و«54.60 / 9.10» (الكرتون/الحبّة) والمجموعَ
 * شاملاً الضريبة — فيقرأ النموذجُ الكمّيّةَ ٦ في كلّ فاتورة (٢٥ من ٢٥ حتّى ٢٦ نوفمبر ٢٠٢٦)
 * وقد اشترينا ١٤ أو ١٥ حبّة، فيصير سعرُ الحبّة ٢١٫٢٣ ويُقال «ارتفع ١٣٣٪». والتوجيهُ في
 * الموجِّه لم يكفِ. فإن لم يستقم الضربُ بالكمّيّة المقروءة، وكان المجموعُ عدداً صحيحاً من
 * الحبّات بسعر حبّةٍ ثابتٍ بالدليل، فذاك العددُ هو الكمّيّة. وسعرُ الحبّة يثبت بأحد:
 *
 *   1. سعران في الخانة، الأكبرُ مضاعفٌ للأصغر («54.60 / 9.10») — الأصغرُ للحبّة.
 *   2. المجموعُ أكبرُ من الكمّيّة × السعر بما لا تفسّره الضريبة — فالسعرُ للحبّة والكمّيّةُ خطأ.
 *   3. السعرُ ÷ الكمّيّة عددٌ صحيح بالهللات (كرتونٌ ÷ حبّاته)، وهو السعرُ المعتاد للصنف عند
 *      مورّده — أو بلا معتادٍ يُعرف: الضربُ يزيد المجموعَ ضعفاً ونصفاً فأكثر (لا خصمَ بهذا القدر؛
 *      وخصمُ ١٠٪ على عشرةٍ بمئة لا يصير «٩٠ حبّة بعشرة»).
 *   4. السعرُ هو المعتادُ للحبّة، والضربُ يزيد المجموعَ ضعفاً ونصفاً فأكثر، والمجموعُ حبّاتٌ
 *      بضريبتها بالضبط («6 × 9.10 = 10.47») — لا خصمٌ يصادف ×١٫١٥.
 *   5. لا سعرَ مقروءاً، والمجموعُ عددٌ صحيح بالسعر المعتاد للصنف.
 *
 * `usualMinor` السعرُ المعتاد للصنف عند مورّده (`usualPrices`) — `null` إن لم يُعرف.
 */
export function packQuantity(
  quantity: number,
  candidates: readonly number[],
  totalMinor: number | null,
  usualMinor: number | null,
): { quantity: number; unitMinor: number } | null {
  if (totalMinor === null || totalMinor <= 0) return null;
  const tryPrice = (p: number, sameQtyOk = false, grossOnly = false) => {
    const n = wholeUnits(totalMinor, p, grossOnly);
    return n !== null && (sameQtyOk || n !== quantity) ? { quantity: n, unitMinor: p } : null;
  };
  /* الضربُ بالكمّيّة المقروءة يزيد المجموعَ ضعفاً ونصفاً فأكثر — لا خصمَ بهذا القدر */
  const farAbove = (unit: number) => unit * quantity * 2 >= totalMinor * 3;
  const isUsual = (p: number) => usualMinor !== null && Math.abs(p - usualMinor) * 100 <= usualMinor;
  const fits = (unit: number) => {
    const r = resolveLinePricing({ quantity, unitPriceMinor: unit, lineTotalMinor: totalMinor });
    return r !== null && (r.basis === "CONSISTENT" || r.basis === "TOTAL_INCLUDES_VAT");
  };

  if (candidates.length === 2) {
    if (candidates.some(fits)) return null;
    return tryPrice(candidates[1]) ?? tryPrice(candidates[0]);
  }
  if (candidates.length === 1) {
    const u = candidates[0];
    if (fits(u)) return null;
    const expected = u * quantity;
    if (totalMinor * 100 > expected * (100 + VAT_PERCENT) + 100 * quantity) {
      const r = tryPrice(u);
      if (r) return r;
    }
    if (quantity >= 2 && u % quantity === 0) {
      const piece = u / quantity;
      const vouched = usualMinor !== null ? isUsual(piece) : farAbove(u);
      if (vouched) {
        const r = tryPrice(piece);
        if (r) return r;
      }
    }
    /*
      سعرُ الحبّة المعتاد نفسُه والمجموعُ حبّاتٌ بضريبتها بالضبط: «6 × 9.10 = 10.47» حبّةٌ واحدة.
      بالشامل وحده: «4 × 100 = 200» عند غاناش خصمُ نصفٍ حقيقيّ لا «حبّتان»، والخصمُ لا يقع على ×١٫١٥.
    */
    if (isUsual(u) && farAbove(u)) return tryPrice(u, false, true);
    return null;
  }
  /* لا سعرَ مقروءاً: المعتادُ يُعطي الكمّيّة — أو يحسم أنّ المجموعَ شاملٌ الضريبة بالكمّيّة نفسها */
  return usualMinor !== null ? tryPrice(usualMinor, true) : null;
}

/* ─────────────────── من القراءة إلى البنود ─────────────────── */

export interface ReadLine {
  description?: string;
  quantity?: string;
  unitPrice?: string;
  lineTotal?: string;
}

/**
 * بنودُ قراءةٍ كما تُقيَّد: سعرُ الوحدة الفعليّ لكلّ بند، مسوّىً بصافي الفاتورة.
 * بابٌ واحد يقرؤه القيدُ (`replaceLines`) وبطاقةُ المراجعة — فلا تقارن البطاقةُ سعرَ
 * القائمة أو السعرَ الشامل للضريبة بما قُيِّد صافياً بعد الخصم.
 */
export function resolveReadLines(
  lines: readonly ReadLine[],
  subtotalMinor: number | null | undefined,
  /** السعرُ المعتاد للصنف عند مورّده بوصفه كما قُرئ — لتصحيح كمّيّة الكرتون (`packQuantity`) */
  usualOf: (description: string) => number | null = () => null,
) {
  const resolved: (LinePricing & { description: string; quantity: number; qtyText: string | null })[] = [];
  for (const l of lines) {
    const description = l.description?.trim();
    if (!description) continue;
    let qtyText = parseLineQuantity(l.quantity);
    let quantity = qtyText === null ? 1 : Number(qtyText);
    const candidates = unitPriceCandidates(l.unitPrice);
    const lineTotalMinor = parseRiyals(l.lineTotal ?? "");
    /* سعران في الخانة: ما يستقيم ضربُه بالكمّيّة المقروءة هو سعرُ الوحدة */
    let unitPriceMinor = candidates.length === 1 ? candidates[0]
      : candidates.find((c) => {
        const b = resolveLinePricing({ quantity, unitPriceMinor: c, lineTotalMinor })?.basis;
        return b === "CONSISTENT" || b === "TOTAL_INCLUDES_VAT";
      }) ?? null;
    /* الكرتونُ مكانَ الحبّة: الكمّيّةُ من المجموع ÷ سعر الحبّة، والسببُ يُحفظ */
    const pack = qtyText === null ? null : packQuantity(quantity, candidates, lineTotalMinor, usualOf(description));
    if (pack) {
      quantity = pack.quantity;
      qtyText = String(pack.quantity);
      unitPriceMinor = pack.unitMinor;
    }
    // السطر بلا سعر ولا مبلغ لا يُسجَّل — صفرٌ مخترع يفسد كل متوسط بعده
    const resolvedLine = resolveLinePricing({ quantity, unitPriceMinor, lineTotalMinor });
    const priced = resolvedLine && pack && pack.quantity !== Number(parseLineQuantity(l.quantity))
      ? { ...resolvedLine, basis: "PACK_QTY" as const }
      : resolvedLine;
    if (!priced) continue;
    /* بلا كمّيّةٍ لا يُعرف أيّ الرقمين سعرُ الوحدة — فلا يدخل تتبّعَ الأسعار */
    const pricing = qtyText === null ? { ...priced, basis: "QTY_UNREAD" as const } : priced;
    resolved.push({ ...pricing, description, quantity, qtyText });
  }
  return reconcileInvoiceLines(resolved, subtotalMinor).lines;
}
