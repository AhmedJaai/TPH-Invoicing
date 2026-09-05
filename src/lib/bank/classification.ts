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
 *   ٤. **المجهول** — يُعلَن مجهولاً ولا يُخمَّن.
 *
 * والطبقة الأعلى تحسم، فلا تُنقَض بما دونها. ونفس المدخل يُنتج نفس
 * المخرج دائماً.
 */
import type { CanonicalTransaction } from "./canonical";
import type { TxKind } from "./taxonomy";

export type Layer = "STRUCTURE" | "LEARNED" | "KEYWORD" | "NONE";

/** نسخة منطق التصنيف — تُرفَع مع كل تغيير في الطبقات أو الكلمات. */
export const CLASSIFICATION_VERSION = "2026-09-05.1";

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
  | "STRUCTURE" | "MEMORY" | "RULE" | "KEYWORD" | "AI" | "HUMAN" | "UNKNOWN";

/** الطبقة التي حسمت ← المصدر الذي يُحفَظ. */
export const LAYER_SOURCE: Record<Layer, ClassificationSource> = {
  STRUCTURE: "STRUCTURE",
  LEARNED: "MEMORY",
  KEYWORD: "KEYWORD",
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

const KEYWORDS: readonly Keyword[] = [
  /*
    ما يلي مأخوذ من كشف أحمد نفسه — لا من تخيّل صيغ.
    «تحويل إلى الأهل والأصدقاء» عبارة البنك لتحويل شخصيّ، وكانت تُقرأ
    سدادَ مورّد فتُنسب إلى المورّدين ظلماً.
  */
  { match: /تحويل\s*الي\s*الاهل|الاهل\s*والاصدقاء|Family\s*(and|&)\s*Friends/i, kind: "OWNER_TRANSFER", label: "تحويل إلى الأهل والأصدقاء" },
  { match: /\bSAUDI\s*TELECOM\b|\bSTC\s*PAY\b/i, kind: "UTILITY", direction: "DEBIT", label: "الاتصالات السعودية" },
  { match: /^CITY\s*:\s*Digital\s*Channel$/i, kind: "BANK_FEE", direction: "DEBIT", label: "رسم القناة الرقمية" },
  // الحكوميّ قبل الزكاة: «زاتكا» ضريبة لا صدقة
  { match: /\bZATCA\b|هيئه\s*الزكاه\s*والضريبه|هيئه\s*الزكاة/i, kind: "GOVERNMENT", direction: "DEBIT", label: "جهة ضريبية" },
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
  */
  const key = merchantKey(tx);
  if (key) {
    const known = memory.get(key);
    if (known) {
      return {
        kind: known.kind,
        layer: "LEARNED",
        source: "MEMORY",
        ruleId: null,
        reason: `أكّدتَ من قبل أنّ هذا المستفيد ${known.confirmations > 1 ? `${known.confirmations} مرّات` : "مرّةً"}`,
        merchantKey: key,
      };
    }
  }

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

  /* ── ٤. المجهول ── */
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
 * مفتاح المستفيد.
 *
 * رقم الحساب أثبت من الاسم — الاسم يُكتب بصيغ، والحساب لا. فإن وُجد
 * حسابٌ في الحركة كان هو المفتاح، وإلّا فاسم المستفيد موحَّداً.
 */
export function merchantKey(tx: CanonicalTransaction): string | null {
  const account = tx.references.find((r) => r.kind === "ACCOUNT" || r.kind === "IBAN");
  if (account) return `ACC:${account.value}`;

  const id = tx.references.find((r) => r.kind === "NATIONAL_ID");
  if (id) return `ID:${id.value}`;

  const name = (tx.beneficiaryRaw ?? "").trim();
  if (name.length >= 3) return `NAME:${name.replace(/\s+/g, " ").toUpperCase()}`;

  return null;
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
