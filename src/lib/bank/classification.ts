/**
 * تصنيف الحركة، بطبقات.
 *
 * كان التصنيف قائمة كلمات مفتاحية، ثمّ فوقها قواعدُ يكتبها المستخدم
 * بيده. والنتيجة أنّ صفوفاً متطابقة حرفاً بحرف تُصنَّف تصنيفين
 * مختلفين — وُجد في قاعدة أحمد مئةٌ واثنان وستّون صفّاً كذلك. وهذا لا
 * يُصلَح بضبط الكلمات: المسار لم يكن دالّة.
 *
 * فصار ترتيباً معلوماً لا يُخالَف:
 *
 *   ١. **البنية**  — ما يُقرأ من شكل الوصف نفسه (حركات الشبكة).
 *   ٢. **المتعلَّم** — ما أكّده الإنسان من قبل لهذا المستفيد بعينه.
 *   ٣. **الكلمات** — دليلٌ ظنّيّ، ولا يُؤخَذ إلّا بشرطه.
 *   ٤. **المقدار** — الصادر الصغير الذي ليس ضريبةً رسمُ بنك.
 *   ٥. **المجهول** — يُعلَن مجهولاً ولا يُخمَّن.
 *
 * والطبقة الأعلى تحسم، فلا تُنقَض بما دونها. ونفس المدخل يُنتج نفس
 * المخرج دائماً.
 */
import type { CanonicalTransaction } from "./canonical";
import { identitiesOf } from "./pattern";
import type { TxKind } from "./taxonomy";
import { countNoun, TIME } from "@/lib/arabic";

export type Layer = "STRUCTURE" | "LEARNED" | "KEYWORD" | "AMOUNT" | "NONE";

/** نسخة منطق التصنيف — تُرفَع مع كل تغيير في الطبقات أو الكلمات. */
export const CLASSIFICATION_VERSION = "2026-09-06.1";

export interface Classification {
  kind: TxKind;
  layer: Layer;
  /** لماذا صُنّفت هكذا — يُعرَض للمستخدم. */
  reason: string;
  /** هوية المستفيد إن عُرفت. */
  merchantKey: string | null;
  /**
   * مصدر التصنيف كما يُحفَظ في القاعدة.
   *
   * وكان يُحسَب ثمّ يُرمى: يُكتب `rule_id = null` صراحةً، فيضيع من
   * صنّف ولماذا — ولا يُقاس بعدها أيّ القواعد أدقّ، ولا يُصحَّح ما أخطأ.
   */
  source: ClassificationSource;
  /** القاعدة التي صنّفت، إن كانت قاعدةً محفوظة. */
  ruleId: string | null;
}

export type ClassificationSource =
  | "STRUCTURE" | "MEMORY" | "RULE" | "KEYWORD" | "AMOUNT" | "AI" | "HUMAN"
  | "UNKNOWN";

/** الطبقة التي حسمت ← المصدر الذي يُحفَظ. */
export const LAYER_SOURCE: Record<Layer, ClassificationSource> = {
  STRUCTURE: "STRUCTURE",
  LEARNED: "MEMORY",
  KEYWORD: "KEYWORD",
  AMOUNT: "AMOUNT",
  NONE: "UNKNOWN",
};

/** ذاكرة المستفيدين: ما أكّده الإنسان من قبل. */
export interface MerchantMemory {
  /** مفتاح ثابت للمستفيد — اسمٌ موحَّد أو رقم حساب. */
  key: string;
  kind: TxKind;
  supplierId: string | null;
  /** كم مرّة أكّده إنسان. */
  confirmations: number;
  /** الجهة صاحبة الدليل — بها يُعرَف اشتراك دليلٍ ظنّيّ بين جهتين. */
  counterpartyId?: string;
}

/**
 * الكلمة الدالّة وشرطها.
 *
 * الشرط جزء من القاعدة لا زينة: «EJAR» إيجار حين تكون سداداً حكوميّاً
 * صادراً، لا حين ترد داخل اسم شركة. و«STC» اتّصالات حين تكون فاتورة،
 * لا حين تكون تحويلاً لشخص يعمل فيها.
 */
interface Keyword {
  match: RegExp;
  kind: TxKind;
  /** يُشترَط الاتجاه حين يكون فارقاً. */
  direction?: "DEBIT" | "CREDIT";
  label: string;
}

/**
 * ما يقول إنّه **ضريبة على رسم** — لا كلّ ما فيه «ضريبة».
 *
 * لأنّ ضريبة الرسم ليست رسماً: بابها غير بابه، ومن جمعهما لم يعد
 * يعرف كم دفع للبنك وكم دفع للدولة.
 *
 * والصيغة مضيَّقة عمداً: «Tax» وحدها تقع في وصف زاتكا
 * («Zakat, Tax and Customs») وهو سدادٌ حكوميّ بأربعة عشر ألف ريال —
 * فلو أُخذت لصار سدادُ الدولة «ضريبةَ رسمٍ بنكيّ».
 */
const VAT_RE = /ضريبه\s*القيمه\s*المضافه|ضريبه\s*عمليه|ضريبه\s*رسوم|\bVAT\b/i;

const KEYWORDS: readonly Keyword[] = [
  /*
    ما يلي مأخوذ من كشف أحمد نفسه — لا من تخيّل صيغ.
    «تحويل إلى الأهل والأصدقاء» عبارة البنك لتحويل شخصيّ، وكانت تُقرأ
    سدادَ مورّد فتُنسب إلى المورّدين ظلماً.
  */
  { match: /تحويل\s*الي\s*الاهل|الاهل\s*والاصدقاء|Family\s*(and|&)\s*Friends/i, kind: "OWNER_TRANSFER", label: "تحويل إلى الأهل والأصدقاء" },
  { match: /\bSAUDI\s*TELECOM\b|\bSTC\s*PAY\b/i, kind: "UTILITY", direction: "DEBIT", label: "الاتصالات السعودية" },
  /*
    الضريبة قبل الرسم دائماً.

    وصفُ الرسم ووصفُ ضريبته واحد — «CITY:Digital Channel» — ولا
    يفرّقهما إلّا «نوع العملية». فمن فحص الرسم أوّلاً نسب إلى البنك
    ما ذهب إلى الدولة، وخمسٌ وثلاثون حركة في كشف أحمد كذلك.

    ولا تُطابَق هنا «Tax» وحدها: وصفُ زاتكا يحملها
    («Zakat, Tax and Customs») وهي سدادٌ حكوميّ لا ضريبةُ رسم.
  */
  { match: VAT_RE, kind: "BANK_VAT", direction: "DEBIT", label: "ضريبة على رسمٍ بنكيّ" },
  /*
    ولا تُقيَّد بأوّل النصّ وآخره: `searchText` يجمع الوصف والنوع
    والمستفيد، فالرسو التي كانت تُعرَف حين يغيب نوعها خرجت مجهولةً
    حين حضر. والمرساة تُطابِق النصّ الكامل لا الحقلَ المقصود.
  */
  { match: /CITY\s*:\s*Digital\s*Channel/i, kind: "BANK_FEE", direction: "DEBIT", label: "رسم القناة الرقمية" },
  // الحكوميّ قبل الزكاة: «زاتكا» ضريبة لا صدقة
  /*
    و«زاتكا» بالعربية كذلك — وكانت تفوت.

    القاعدة تعرف `ZATCA` لاتينيةً و«هيئه الزكاه والضريبه» كاملةً،
    ولا تعرف النطق العربيّ المختصر الذي يكتبه الأهليّ في أوصافه.
    فحركةُ سدادٍ حكوميّ تخرج مجهولةً، ثمّ — لو وافق مبلغُها فاتورةً —
    تُنسَب إلى مورّد.
  */
  /*
    وبالإنجليزية كذلك: الأهليّ يكتبها «Zakat, Tax and Customs Au
    thority» — مقطوعةً كعادته. فالقاعدة تعرف الاسم العربيّ والمختصر
    ولا تعرف هذا، وأربعة عشر ألف ريالٍ من سدادٍ حكوميّ تخرج مجهولة.
  */
  { match: /\bZATCA\b|زاتكا|هيئه\s*الزكاه\s*والضريبه|هيئه\s*الزكاة|Zakat,?\s*Tax\s*and\s*Customs/i, kind: "GOVERNMENT", direction: "DEBIT", label: "جهة ضريبية" },
  { match: /\bMinistry\s+of\b|وزاره\s|امانه\s|بلديه/i, kind: "GOVERNMENT", direction: "DEBIT", label: "جهة حكومية" },
  { match: /التامينات\s*الاجتماعيه|\bGOSI\b/i, kind: "GOVERNMENT", direction: "DEBIT", label: "التأمينات الاجتماعية" },
  { match: /\bEJAR\b|ايجار|شبكه\s*ايجار/i, kind: "RENT", direction: "DEBIT", label: "منصّة إيجار" },
  { match: /رواتب|\bSALARY\b|\bPAYROLL\b|Monthly\s*Sal/i, kind: "SALARY", direction: "DEBIT", label: "وصفٌ يقول راتباً" },
  { match: /\bSTC\b|\bMOBILY\b|\bZAIN\b|الاتصالات\s*السعوديه/i, kind: "UTILITY", direction: "DEBIT", label: "مشغّل اتصالات" },
  { match: /Saudi\s*Energy|الشركه\s*السعوديه\s*للكهرباء|كهرباء|\bSWCC\b|مياه/i, kind: "UTILITY", direction: "DEBIT", label: "كهرباء أو مياه" },
  { match: /زكاه|صدقه|جمعيه\s*خيريه/i, kind: "ZAKAT", direction: "DEBIT", label: "زكاة أو صدقة" },
  { match: /رسوم\s*تحويل|رسوم\s*شهريه|Service\s*Charge|\bFEE\b/i, kind: "BANK_FEE", direction: "DEBIT", label: "رسم بنكيّ مصرَّح" },
  { match: /تحويل\s*داخلي|Internal\s*Transfer|بين\s*حسابات/i, kind: "INTERNAL_TRANSFER", label: "تحويل بين حسابات" },
];

/**
 * ما يقوله الوصف صراحةً أنّه شراء بضاعة — يُقدَّم على أي كلمة أخرى.
 *
 * وُجد في كشف أحمد خمس حركات وصفها «شراء بضاعة» وقد صنّفتها قواعده
 * راتباً، لأنّ القاعدة تعلّمت اسم شخصٍ هو مورّد وموظّف معاً.
 */
const GOODS_RE = /شراء\s*بضاعه|شراء\s*بضاعة|قيمه\s*بضاعه|goods\s*purchase/i;

/**
 * حدّ الرسم الصغير: عشرون ريالاً.
 *
 * والحدّ **دون** لا **حتى**: العشرون نفسها ليست رسماً — قد تكون سداداً
 * صغيراً أو تحويلاً. وما دون ذلك لا يُدفَع لمورّدٍ ولا يُقبَض راتباً.
 */
export const SMALL_FEE_MAX_MINOR = 20_00;


export function classify(
  tx: CanonicalTransaction,
  memory: ReadonlyMap<string, MerchantMemory> = new Map(),
): Classification {
  /* ── ١. البنية ── */
  if (tx.pos) {
    return {
      kind: tx.pos.kind,
      layer: "STRUCTURE",
      source: "STRUCTURE",
      ruleId: null,
      reason: `بنية الوصف تقول إنّها حركة شبكة${tx.pos.scheme ? ` (${tx.pos.scheme})` : ""}`,
      merchantKey: tx.pos.merchantId ? `POS:${tx.pos.merchantId}` : null,
    };
  }

  /* ── ٢. المتعلَّم ── */
  /*
    المفتاح يُحسب قبل الكلمات كي يعمّ التعلّم: من أكّد مرّةً أنّ صاحب
    الهوية ٢١٤٩٨٣٠١١٥ هو نفسه، صُنّفت تحويلاته كلّها بعدها بلا سؤال —
    وهي في كشفه أكثر من ثلاثين حركة.

    وتُجرَّب هويّات الحركة **كلّها** بالترتيب لا أقواها وحدها. كان
    يُجرَّب مفتاحٌ واحد، فالحركة التي لا اسم لها ولا حساب لا مفتاح لها
    أصلاً: يؤكّدها الإنسان مئة مرّة فلا تُعرَف أختُها. وفي كشف أحمد
    كانت تلك حالَ **كلّ** حركةٍ مجهولة — خمسٍ وثمانين.
  */
  const identities = identitiesOf(tx);
  for (const identity of identities) {
    const known = memory.get(identity.key);
    if (!known) continue;
    return {
      kind: known.kind,
      layer: "LEARNED",
      source: "MEMORY",
      ruleId: null,
      reason: `${identity.label} أكّدتَه من قبل ${countNoun(known.confirmations, TIME)}`,
      merchantKey: identity.key,
    };
  }
  const key = identities[0]?.key ?? null;

  /* ── ٣. الكلمات ── */
  if (GOODS_RE.test(tx.searchText)) {
    return {
      kind: "SUPPLIER_PAYMENT",
      layer: "KEYWORD",
      source: "KEYWORD",
      ruleId: null,
      reason: "الوصف يقول صراحةً إنّه شراء بضاعة",
      merchantKey: key,
    };
  }

  for (const k of KEYWORDS) {
    if (k.direction && k.direction !== tx.direction) continue;
    if (!k.match.test(tx.searchText)) continue;
    return {
      kind: k.kind, layer: "KEYWORD", source: "KEYWORD", ruleId: null,
      reason: k.label, merchantKey: key,
    };
  }

  /* ── ٤. المقدار ── */
  /*
    الصادر الأقلّ من عشرين ريالاً — إن لم يكن ضريبةً — رسمُ بنك.

    في كشف الأهليّ رسومٌ صغيرة كثيرة لا يقول وصفها شيئاً، وبعضها
    بوصفٍ فارغ تماماً. ولا مورّد يُدفَع له ثلاثة ريالات، ولا راتب.
    فالمقدار هنا دليلٌ أقوى من الصمت.

    وموضعها بعد الكلمات مقصود: زكاةُ خمسة ريالات تبقى زكاةً، ورسمُ
    القناة الرقمية يبقى بوصفه. والمقدار لا ينقض ما قيل صراحةً.

    ولا تُطبَّق على الوارد: مالٌ يدخل الحساب ليس رسماً مهما صغر.
  */
  if (
    tx.direction === "DEBIT"
    && tx.amountMinor > 0
    && tx.amountMinor < SMALL_FEE_MAX_MINOR
  ) {
    return {
      kind: "BANK_FEE",
      layer: "AMOUNT",
      source: "AMOUNT",
      ruleId: null,
      reason: "صادرٌ أقلّ من عشرين ريالاً وليس ضريبة — رسمُ بنك بحكم مقداره",
      merchantKey: key,
    };
  }

  /* ── ٥. المجهول ── */
  return {
    kind: "UNKNOWN",
    layer: "NONE",
    source: "UNKNOWN",
    ruleId: null,
    reason:
      tx.direction === "CREDIT"
        ? "وارد لم يُعرف مصدره — ولا يُفترَض أنّه ضجيج"
        : "لم يُعرف المستفيد ولا دلّ الوصف على بابٍ",
    merchantKey: key,
  };
}

/**
 * أقوى مفاتيح المستفيد — والقائمة كلّها في `identitiesOf`.
 *
 * رقم الحساب أثبت من الاسم — الاسم يُكتب بصيغ، والحساب لا. ثمّ النمط
 * بعدهما: هو ما يبقى حين لا يكون للحركة اسمٌ ولا حساب، وهو حال أكثر
 * ما يخرج مجهولاً.
 *
 * والتوحيد هنا هو التوحيد في `counterparty.service` نفسه — كان الاسم
 * يُكتب موحَّداً ويُقرأ خاماً، فلا يلتقيان في اسمٍ فيه همزةٌ أو تاء
 * مربوطة، وهو أكثر الأسماء العربية.
 */
export function merchantKey(tx: CanonicalTransaction): string | null {
  return identitiesOf(tx)[0]?.key ?? null;
}

/**
 * يبني الذاكرة ممّا أكّده الإنسان.
 *
 * والتأكيد المتكرّر يرفع الثقة؛ والتضارب لا يُحسَم بالأغلبية بل يُترَك
 * للأحدث، لأنّ المستفيد قد يتغيّر بابه فعلاً.
 */
export function buildMemory(
  confirmations: readonly { key: string; kind: TxKind; supplierId: string | null; at: Date }[],
): Map<string, MerchantMemory> {
  const map = new Map<string, MerchantMemory>();
  const latest = new Map<string, Date>();

  for (const c of confirmations) {
    const prev = map.get(c.key);
    const prevAt = latest.get(c.key);

    if (!prev || !prevAt || c.at >= prevAt) {
      map.set(c.key, {
        key: c.key,
        kind: c.kind,
        supplierId: c.supplierId,
        confirmations: (prev?.kind === c.kind ? prev.confirmations : 0) + 1,
      });
      latest.set(c.key, c.at);
    } else if (prev.kind === c.kind) {
      map.set(c.key, { ...prev, confirmations: prev.confirmations + 1 });
    }
  }

  return map;
}
