/**
 * النموذج المعياريّ للحركة البنكية.
 *
 * كان النظام يحمل خمسة حقول — تاريخ ومبلغ واتجاه ووصف ونوع — ويجمع
 * الوصف والنوع في نصٍّ واحد ثمّ يبحث فيه عن اسم. والمعلومة في الكشف
 * الحقيقيّ موزّعة: المستفيد في عمود، والمرجع في آخر، ورقم التاجر داخل
 * الوصف، والقناة في نوع العملية. فجمعها كلّها في نصّ يُضيّع بنيتها.
 *
 * وهذا النموذج يفصلها، ولا يعرف بنكاً بعينه: كل قارئ بنك يُخرج هذا،
 * وما بعده لا يسأل من أيّ بنك جاء.
 */
import { recognizePos, type PosDetails } from "./pos";

export interface RawBankRow {
  valueDate: Date;
  postingDate?: Date | null;
  description?: string | null;
  beneficiaryRaw?: string | null;
  transactionType?: string | null;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  balanceAfterMinor?: number | null;
  /** الصفّ كما ورد — يُحفظ كي يُراجَع مصدر أيّ رقم. */
  rawRow?: Record<string, unknown>;
}

export interface CanonicalTransaction extends RawBankRow {
  /** كل ما يُقرأ فيه اسمٌ أو رقم، موحَّداً. */
  searchText: string;
  /** المراجع المستخرجة، مصنَّفةً — لا «أوّل رقم طويل». */
  references: Reference[];
  /** تفاصيل حركة الشبكة إن كانت منها. */
  pos: PosDetails | null;
  /** القناة كما يقولها البنك: هاتف · تطبيق · فرع … */
  channel: string | null;
  /**
   * المستفيد كما يقوله **البنك** — مقروءاً من الوصف لا من العمود.
   *
   * العمود `beneficiary_raw` ملوَّث في الصفوف القديمة: كان الاستيراد
   * يكتب فيه اسم المورّد الذي طابقه هو، لا المستفيد. وسبعةٌ وثلاثون
   * صفّاً من ستّة وأربعين كذلك. فبُني عليه تجميعٌ جمع أربع حوالات
   * لأربع جهات مختلفة تحت اسمٍ واحد — «سبعة جرة» وهي أصلاً عميل لا
   * مورّد. وقرارٌ واحد عليها كان سيُخطئ في أربع.
   *
   * فصار يُقرأ من نصّ البنك؛ والعمود لا يُصدَّق إلّا إذا أيّده النصّ.
   */
  beneficiary: string | null;
}

export type ReferenceKind =
  | "IBAN" | "ACCOUNT" | "NATIONAL_ID" | "SADAD" | "BANK_REF" | "NUMBER";

export interface Reference {
  kind: ReferenceKind;
  value: string;
  /** ما دلّ عليه: الكلمة التي سبقته أو الصيغة التي طابقها. */
  evidence: string;
}

/* ─────────────────── التوحيد ─────────────────── */

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

/**
 * يوحّد النصّ للبحث.
 *
 * ويُبقي الأرقام والحروف كما هي دون دمج، لأنّ «VM26» ليست «VM 26».
 */
export function normalizeText(s: string | null | undefined): string {
  return toLatinDigits(s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/* ─────────────────── المراجع ─────────────────── */

/**
 * يستخرج المراجع مصنَّفةً.
 *
 * كان الاستخراج: «أوّل سلسلة أرقام طولها ستّة فأكثر». وفي كشفٍ حقيقيّ
 * قد يكون أوّلها رقم الآيبان، أو رقم الهوية، أو رقم التاجر لدى الشبكة —
 * فيُؤخذ الشيء الخطأ ويُبنى عليه.
 *
 * فصار كل رقم يُنسب إلى نوعه بدليلٍ من نصّه أو ممّا سبقه، وتُرجَع
 * القائمةُ كلّها لا واحداً منها. ومن يطابق بالمرجع يختار النوع الذي
 * يعنيه.
 */
const IBAN_RE = /\bSA\d{22}\b/gi;
const SADAD_RE = /(?:رقم\s*السداد|SADAD)\s*:?\s*(\d{6,})/gi;
const BEN_ID_RE = /BEN\s*ID\s*:?\s*(\d{6,})/gi;
const REF_RE = /(?:مرجع(?:\s*سداد)?|REFERENCE|REF)\s*:?\s*(\d{4,})/gi;
const ACCOUNT_RE = /\b\d{14}\b/g;
const ANY_LONG_RE = /\b\d{6,}\b/g;

export function extractReferences(text: string): Reference[] {
  const found: Reference[] = [];
  const seen = new Set<string>();

  const push = (kind: ReferenceKind, value: string, evidence: string) => {
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ kind, value, evidence });
  };

  for (const m of text.matchAll(IBAN_RE)) push("IBAN", m[0].toUpperCase(), "صيغة آيبان");
  for (const m of text.matchAll(SADAD_RE)) push("SADAD", m[1], "سبقته «رقم السداد»");
  for (const m of text.matchAll(BEN_ID_RE)) push("NATIONAL_ID", m[1], "سبقته «BEN ID»");
  for (const m of text.matchAll(REF_RE)) push("BANK_REF", m[1], "سبقته «مرجع»");
  for (const m of text.matchAll(ACCOUNT_RE)) push("ACCOUNT", m[0], "أربعة عشر رقماً");

  /*
    ما بقي من أرقام طويلة يُسجَّل مجهول النوع — لا يُدَّعى أنّه مرجع.
    وما دخل تحت نوعٍ معروف لا يُكرَّر هنا.
  */
  const claimed = new Set(found.map((f) => f.value));
  for (const m of text.matchAll(ANY_LONG_RE)) {
    if (!claimed.has(m[0])) push("NUMBER", m[0], "رقم طويل بلا دليل على نوعه");
  }

  return found;
}

/** المراجع التي تصلح للمطابقة برقم الفاتورة — لا الآيبان ولا الهوية. */
export function matchableReferences(refs: readonly Reference[]): Reference[] {
  return refs.filter((r) => r.kind === "BANK_REF" || r.kind === "SADAD" || r.kind === "NUMBER");
}

/* ─────────────────── القناة ─────────────────── */

const CHANNELS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /هاتف\s*الاهلي|PHONE\s*BANK/i, label: "هاتف البنك" },
  { pattern: /اي\s*كورب|E-?CORP|ECORP/i, label: "الخدمة المؤسسية" },
  { pattern: /Digital\s*Channel|القناة\s*الرقمية/i, label: "القناة الرقمية" },
  { pattern: /ATM|صراف/i, label: "صرّاف آلي" },
  { pattern: /\bPOS\b|نقاط\s*بيع/i, label: "نقاط البيع" },
];

export function detectChannel(text: string): string | null {
  for (const c of CHANNELS) if (c.pattern.test(text)) return c.label;
  return null;
}

/* ─────────────────── المستفيد ─────────────────── */

/**
 * ما يدلّ على أنّ في الوصف اسمَ مستفيدٍ أصلاً.
 *
 * ولا يُشتقّ اسمٌ من كلّ وصف: «CITY:Digital Channel» رسمٌ لا مستفيد
 * له، و«81140155-260626-POS 0» حركةُ شبكة. واشتقاقُ اسمٍ منهما يصنع
 * جهةً وهميّة تُجمَع تحتها حركات.
 */
const HAS_BENEFICIARY = /BEN\s*ID|BENBK|حوالات\s*تحت\s*الطلب|رقم\s*السداد/i;

/** ما بعده ليس من الاسم. */
const BENEFICIARY_END =
  /BEN\s*ID|BENBK|REMBK|Business\s+contracts|Value\s*Date|Buying\s+Goods|رقم\s*السداد|مرجع|بنك\s+\S+|شراء\s*بضاع[هة]|\bB[UVB]:/i;

/** بقايا صيغة الحوالة قبل الاسم: تاريخٌ ورمزُ عمليّة. */
const TRANSFER_NOISE = /^(?:\d+[A-Z]?|[A-Z]*\d[A-Z0-9]{5,}|NCBK\S*)$/i;

/**
 * يقرأ اسم المستفيد من وصف البنك.
 *
 * والصيغة في كشف الأهليّ: عبارةُ الحوالة، ثمّ تاريخٌ ورمزُ عمليّة، ثمّ
 * **الاسم**، ثمّ اسم بنك المستفيد أو رقم هويّته. فيُقصّ الطرفان ويبقى
 * ما بينهما.
 */
export function beneficiaryFrom(description: string | null | undefined): string | null {
  const raw = (description ?? "").trim();
  if (raw.length === 0 || !HAS_BENEFICIARY.test(raw)) return null;

  let text = raw.replace(/^\s*حوالات\s*تحت\s*الطلب\s*/i, "");

  const end = text.search(BENEFICIARY_END);
  if (end > 0) text = text.slice(0, end);

  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  while (tokens.length > 0 && TRANSFER_NOISE.test(tokens[0])) tokens.shift();

  const name = tokens.join(" ").replace(/[:,،.\-]+$/, "").trim();
  if (name.length < 3) return null;
  if ((name.match(/\p{L}/gu) ?? []).length < 3) return null;
  return name;
}

/* ─────────────────── التحويل ─────────────────── */

export function toCanonical(row: RawBankRow): CanonicalTransaction {
  /*
    النصّ يُبنى من الحقول كلّها لأنّ البنك يوزّع المعلومة عليها — لكنّ
    الحقول تبقى منفصلة في النموذج، فمن أراد المستفيد وحده وجده.
  */
  const parts = [row.beneficiaryRaw, row.description, row.transactionType]
    .filter((p): p is string => Boolean(p && p.trim()));
  const searchText = normalizeText(parts.join(" · "));

  return {
    ...row,
    searchText,
    references: extractReferences(searchText),
    /*
      النوع يدخل التعرّف على حركات الشبكة — لا النصّ وحده.

      «٨١١٤٠١٥٥-٢٦٠٦٢٦-POS 0» لا كلمة فيه تقول ما هو، ونوعُه يقول
      «ضريبة عملية نقاط بيع فوري». وكان يُقرأ ثمّ يُطرح.

      ولا يدخل `signatureOf` — هناك خاصّيةُ تصديرٍ تفرّق نمط الحركة
      الواحدة بين ملفّين. وهنا دليلٌ صريح على بابها. والفرق أنّ الأوّل
      هويّةٌ تُقارَن، والثاني وصفٌ يُقرأ.
    */
    pos: recognizePos(row.description, row.direction, row.transactionType),
    /*
      نصّ البنك يسبق العمود، ولا يُلغيه.

      فالعمود في الكشوف الجديدة يُقرأ من الكشف نفسه وهو خبرٌ صحيح؛
      وفي الصفوف القديمة ملوَّث بما كتبه نظامُنا. والوصفُ حكَمٌ بينهما:
      إن حمل اسماً فهو المقدَّم، وإلّا فالعمود على حاله.

      والتلوّث يُعالَج في مصدره — `db:reclassify` يعيد كتابة العمود
      ممّا قاله البنك ويُفرّغ ما لم يقله — لا بالالتفاف حوله في كل قراءة.
    */
    beneficiary: beneficiaryFrom(row.description) ?? row.beneficiaryRaw?.trim() ?? null,
    channel: detectChannel(searchText),
  };
}
