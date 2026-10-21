/**
 * الخصمُ قبل الضريبة — يُنقص الوعاءَ لا الإجماليَّ وحده.
 *
 * إيصالُ «مود القهوة»: مجموعٌ ٢٠٩٫٠٠ · خصمٌ ٣١٫٣٥ · ضريبةٌ ٢٦٫٦٥ · إجماليٌّ ٢٠٤٫٣٠.
 * الجمعُ يستقيم بقراءتين: خصمٌ بعد الضريبة (٢٠٩ + ٢٦٫٦٥ − ٣١٫٣٥) أو قبلها
 * ((٢٠٩ − ٣١٫٣٥) + ٢٦٫٦٥) — والحسابُ واحد. ويفصل بينهما **الضريبةُ نفسُها**:
 * ٢٦٫٦٥ هي ١٥٪ من ١٧٧٫٦٥ لا من ٢٠٩. فالخاضعُ للضريبة ١٧٧٫٦٥، وبه تُحسب كلفةُ
 * المشتريات — وكان يُقيَّد ٢٠٩ فتُضخَّم الكلفةُ بالخصم كلِّه.
 *
 * والنموذجُ يُسأل عن «الصافي بعد الخصم» فيكتب المطبوعَ تحت «المجموع». فيُصحَّح هنا
 * حتميّاً — لا يُسأل ثانية.
 *
 * خالصة.
 */
import { formatRiyals, parseRiyals, TOTAL_ROUNDING_TOLERANCE_MINOR } from "@/lib/money";
import type { ExtractionResult } from "./schema";

/** نسبةُ ضريبة القيمة المضافة — ١٥٪ */
const VAT_PERCENT = 15;

const vatOf = (base: number) => Math.round((base * VAT_PERCENT) / 100);
const near = (a: number, b: number) => Math.abs(a - b) <= TOTAL_ROUNDING_TOLERANCE_MINOR;

export interface PreVatDiscount {
  /** المجموعُ قبل الخصم */
  grossMinor: number;
  discountMinor: number;
}

/**
 * يصحّح الوعاءَ إن كان الخصمُ قبل الضريبة وقُرئ المجموعُ قبله، ويُرجع تفصيلَه للعرض.
 * يُعاد تشغيلُه فلا يتغيّر شيء (بعد التصحيح لا يستقيم الشرطُ الأوّل ثانية).
 */
export function settlePreVatDiscount(x: ExtractionResult): { value: ExtractionResult; discount: PreVatDiscount | null } {
  const sub = parseRiyals(x.subtotalAmount ?? "");
  const vat = parseRiyals(x.vatAmount ?? "");
  const total = parseRiyals(x.totalAmount ?? "");
  const d = parseRiyals(x.discountAmount ?? "");
  if (sub === null || vat === null || total === null || d === null || d <= 0 || d >= sub) return { value: x, discount: null };

  const base = sub - d;
  /*
    قُرئ المجموعُ قبل الخصم، والخصمُ قبل الضريبة: الجمعُ بالوعاء المخصوم يستقيم، والضريبةُ
    ١٥٪ منه لا من المجموع. (وفاتورةٌ بلا ضريبة: الخصمُ يُنقص الكلفةَ أيّاً كان موضعُه.)
  */
  const preVat = near(base + vat, total) && (vat === 0 ? true : near(vat, vatOf(base)) && !near(vat, vatOf(sub)));
  if (preVat) {
    return { value: { ...x, subtotalAmount: formatRiyals(base) }, discount: { grossMinor: sub, discountMinor: d } };
  }
  /* قُرئ الوعاءُ بعد الخصم أصلاً: يُعرض ما قبله، ولا يُصحَّح شيء */
  if (vat > 0 && near(sub + vat, total) && near(vat, vatOf(sub))) {
    return { value: x, discount: { grossMinor: sub + d, discountMinor: d } };
  }
  return { value: x, discount: null };
}
