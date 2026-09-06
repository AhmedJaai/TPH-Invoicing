/**
 * حركات شبكة نقاط البيع.
 *
 * تُقرأ من صيغتين حقيقيتين في كشف الأهلي:
 *
 *   81140155-260718-POS MC Se ttlem 125207
 *   REFERENCE : 81140155 MC26 0831 000000
 *
 * والفراغ داخل الكلمات مقصودٌ في نقلي لا خطأ: البنك يقطع «Settlement»
 * إلى «Se ttlem» و«Fees» إلى «Fe es» و«VAT» إلى «VA T». وهذا وحده
 * يُبطل أي مطابقة بكلمة مفتاحية — ولذلك تُزال الفراغات قبل الفحص.
 *
 * وهي ليست ضجيجاً: ثمانمئة وأربعون ألف ريال من تسويات البطاقات كانت
 * تُصنَّف «حركة تشغيلية» فلا يحلّلها شيء. وهي إيراد المقهى يصل حسابه.
 */
import type { TxKind } from "./taxonomy";

export interface PosDetails {
  kind: Extract<TxKind, "POS_SETTLEMENT" | "POS_FEE" | "POS_VAT">;
  /** رقم التاجر لدى الشبكة — ثابتٌ للمنشأة. */
  merchantId?: string;
  /** رمز الشبكة: MC ماستر · VC/VM فيزا · MD مدى … */
  scheme?: string;
  /** تاريخ الدفعة كما في الوصف: YYMMDD. */
  batchDate?: string;
  /** رقم الدفعة عند الشبكة. */
  batchRef?: string;
}

/** يُزيل الفراغات وحالة الأحرف كي لا يحجب قطعُ البنك للكلمات المطابقةَ. */
export function squash(text: string): string {
  return text.replace(/[\s‏‎]/g, "").toUpperCase();
}

const SETTLEMENT = "SETTLEM";
const FEES = "FEES";
const VAT = "VAT";

/** `81140155-260718-POS MC Se ttlem 125207` */
const INLINE_RE = /^(\d{6,})-(\d{6})-POS\s+(.*)$/i;

/** `REFERENCE : 81140155 MC26 0831 000000` */
const REFERENCE_RE = /^REFERENCE\s*:\s*(\d{6,})\s+([A-Z]{2})(\d{2})\s+(\d{4})/i;

/**
 * يتعرّف على الحركة من وصفها واتجاهها.
 *
 * الاتجاه جزء من التعريف لا زينة: نفس رمز الشبكة يأتي وارداً تسويةً
 * وصادراً رسوماً. و`null` تعني «ليست حركة شبكة» — لا «لم أعرفها».
 */
export function recognizePos(
  description: string | null | undefined,
  direction: "DEBIT" | "CREDIT",
  transactionType?: string | null,
): PosDetails | null {
  const raw = (description ?? "").trim();
  if (raw.length === 0) return fromType(transactionType);

  const inline = raw.match(INLINE_RE);
  if (inline) {
    const [, merchantId, batchDate, tail] = inline;
    const flat = squash(tail);
    const scheme = tail.trim().split(/\s+/)[0]?.toUpperCase();
    const batchRef = tail.match(/(\d{4,})\s*$/)?.[1];

    const kind = kindOf(flat, direction) ?? fromType(transactionType)?.kind;
    if (!kind) return null;
    return {
      kind,
      merchantId,
      scheme: /^[A-Z]{2}$/.test(scheme ?? "") ? scheme : undefined,
      batchDate,
      batchRef,
    };
  }

  const ref = raw.match(REFERENCE_RE);
  if (ref) {
    const [, merchantId, scheme, yy, mmdd] = ref;
    /*
      سطر REFERENCE لا يحمل كلمةً تقول ما هو — فالاتجاه وحده يفصل:
      الوارد تسوية، والصادر رسمٌ من الشبكة.
    */
    return {
      kind: direction === "CREDIT" ? "POS_SETTLEMENT" : "POS_FEE",
      merchantId,
      scheme,
      batchDate: `${yy}${mmdd}`,
    };
  }

  return fromType(transactionType);
}

/**
 * ما يقوله البنك في «نوع العملية» صراحةً.
 *
 * والوصف قد يصمت: `81140155-260626-POS 0` لا كلمة فيه، و
 * `PoSMonthlyFeeSep81140156` لا يشبه صيغة الدفعات. والنوع يقولها
 * كاملةً: «ضريبة عملية نقاط بيع فوري». وكان يُقرأ للمطابقة ثمّ يُطرح
 * من التصنيف — فبقيت حركاتٌ «غير مصنَّفة» وما يصنّفها مكتوبٌ في عمودٍ
 * مجاور.
 *
 * والضريبة تُفحص قبل الرسم: نصّها يحوي «رسوم» أحياناً.
 */
function fromType(transactionType?: string | null): PosDetails | null {
  const t = (transactionType ?? "")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length === 0) return null;
  if (!/نقاط\s*بيع|دفع\s*الكتروني/.test(t)) return null;

  if (/ضريبه/.test(t)) return { kind: "POS_VAT" };
  if (/رسوم|شهري/.test(t)) return { kind: "POS_FEE" };
  if (/ايداع|دفع\s*الكتروني/.test(t)) return { kind: "POS_SETTLEMENT" };
  return null;
}

function kindOf(flat: string, direction: "DEBIT" | "CREDIT"): PosDetails["kind"] | null {
  // الضريبة تُفحص قبل الرسوم: سطر الضريبة يحمل الرمزين أحياناً
  if (flat.includes(VAT)) return "POS_VAT";
  if (flat.includes(FEES)) return "POS_FEE";
  if (flat.includes(SETTLEMENT)) return "POS_SETTLEMENT";

  /*
    `81140155-260526-POS 119872` بلا كلمة: الاتجاه هو الدليل الوحيد.
    والوارد من الشبكة تسويةٌ قطعاً؛ أمّا الصادر فلا يُخمَّن.
  */
  if (direction === "CREDIT") return "POS_SETTLEMENT";
  return null;
}

/**
 * دفعة التسوية: ما يجمع تسويةً برسومها وضريبتها.
 *
 * الشبكة تودع الإيراد ثمّ تخصم رسومها في حركة أخرى بنفس رقم الدفعة —
 * ومن لم يجمعهما ظنّ الإيراد أكبر ممّا وصل.
 */
export function batchKey(p: PosDetails): string | null {
  if (!p.merchantId || !p.batchDate) return null;
  return `${p.merchantId}:${p.batchDate}:${p.scheme ?? "?"}`;
}

export interface PosBatch {
  key: string;
  settlementMinor: number;
  feeMinor: number;
  vatMinor: number;
  /** ما وصل فعلاً بعد الخصم. */
  netMinor: number;
  count: number;
}

export function groupBatches(
  rows: readonly { pos: PosDetails; amountMinor: number }[],
): PosBatch[] {
  const map = new Map<string, PosBatch>();

  for (const r of rows) {
    const key = batchKey(r.pos);
    if (!key) continue;

    const b = map.get(key) ?? {
      key, settlementMinor: 0, feeMinor: 0, vatMinor: 0, netMinor: 0, count: 0,
    };
    b.count++;
    if (r.pos.kind === "POS_SETTLEMENT") b.settlementMinor += r.amountMinor;
    if (r.pos.kind === "POS_FEE") b.feeMinor += r.amountMinor;
    if (r.pos.kind === "POS_VAT") b.vatMinor += r.amountMinor;
    b.netMinor = b.settlementMinor - b.feeMinor - b.vatMinor;
    map.set(key, b);
  }

  return [...map.values()].sort((a, b) => b.settlementMinor - a.settlementMinor);
}
