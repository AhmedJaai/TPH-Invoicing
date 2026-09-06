/**
 * النمط: هويّةُ الحركة حين لا يكون لها اسمٌ ولا حساب.
 *
 * الذاكرة كانت تُمسك الحركةَ من اسم المستفيد أو رقم حسابه. وفي كشف
 * أحمد الحقيقيّ **كل** الحركات المجهولة — خمسٌ وثمانون — بلا اسم
 * مستفيد وبلا رقم حساب: سدادٌ حكوميّ عبر «سداد»، ورسومُ نقاط بيع،
 * ووصفٌ فارغ. فمفتاح الذاكرة يخرج `null` لكلّها، ولا يجد التعلّمُ ما
 * يتعلّق به: يؤكّد الإنسان مئة مرّة فلا يُعرَف شيء.
 *
 * والذي يميّزها موجودٌ ومكرَّر: **شكلُ الوصف**. فـ
 *
 *     Zakat, Tax and Customs Authority رقم السداد310007971626300 …
 *     Zakat, Tax and Customs Authority رقم السداد310007971600003 …
 *
 * حركتان مختلفتان في أرقامهما، متطابقتان في نمطهما. فيُستخرَج النمط
 * بإسقاط ما يتغيّر — الأرقام — وإبقاء ما يثبت: الكلمات وترتيبها.
 *
 * ولا يدخل النمطَ «نوع العملية»: هو خاصّية تصديرٍ لا خاصّية حركة —
 * يملؤه كشفٌ ويتركه آخر لنفس الحركة بعينها — فلو دخل لتفرّق نمط
 * الحركة الواحدة بين ملفّين. وهو الدرس نفسه الذي أخرج رقم الحساب من
 * بصمة الحركة في `identity.ts`.
 *
 * والنمط دليلٌ **ظنّي** لا قاطع: قد يشترك فيه اثنان. فإن اشترك سقط من
 * الذاكرة كما يسقط الاسم المشترَك — لأنّه لم يعد يدلّ على واحدة.
 */
import { normalizeText, type CanonicalTransaction } from "./canonical";

/**
 * كم كلمةً تدخل النمط.
 *
 * لا يُؤخَذ الوصف كلّه: ذيوله مراجعُ وأرقامُ عمليّاتٍ تطول وتقصر. ولا
 * تُؤخَذ كلمتان: «حوالات تحت الطلب» وحدها تجمع كلّ الموردين في نمطٍ
 * واحد. واثنتا عشرة تكفي لأن يدخل اسم الجهة — وهو في أوصاف الأهليّ
 * يقع بعد عبارة التحويل مباشرةً.
 */
export const SIGNATURE_TOKENS = 12;

/** أنواع ما يدلّ على الجهة، من أقطعها إلى أظنّها. */
export type IdentityKind =
  | "ACCOUNT" | "IBAN" | "NATIONAL_ID" | "MERCHANT_ID" | "NAME" | "PATTERN";

export interface Identity {
  kind: IdentityKind;
  /** القيمة كما وردت — تُعرَض للإنسان. */
  value: string;
  /** القيمة موحَّدةً — وهي التي تُخزَّن ويُطابَق بها. */
  normalized: string;
  /** مفتاح الذاكرة: تمثيلٌ واحد يُبحَث به ويُكتَب به. */
  key: string;
  /** لماذا جُمعت هذه الحركات معاً — يُعرَض، لا يُخمَّن. */
  label: string;
}

/**
 * يشتقّ نمط الوصف.
 *
 * يُرجع `null` حين لا يبقى في الوصف كلمةٌ واحدة — نمطٌ كلّه أرقام لا
 * يقول شيئاً، والادّعاء بأنّه هويّة أسوأ من الاعتراف بالجهل.
 */
export function signatureOf(tx: CanonicalTransaction): string | null {
  const source = [tx.beneficiaryRaw, tx.description]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(" ");

  const tokens = normalizeText(source)
    .toUpperCase()
    // ما ليس حرفاً ولا رقماً فاصلٌ — الشرطة والنقطتان وغيرهما
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    // كل سلسلة أرقام تصير علامةً واحدة: هي ما يتغيّر بين حركةٍ وأختها
    .replace(/\p{N}+/gu, "#")
    .split(" ")
    .filter((t) => t.length > 0);

  const shape: string[] = [];
  for (const t of tokens) {
    // «# #» و«# # #» شكلٌ واحد — طولُ سلسلة المراجع ليس معنى
    if (t === "#" && shape[shape.length - 1] === "#") continue;
    shape.push(t);
    if (shape.length >= SIGNATURE_TOKENS) break;
  }

  const hasWord = shape.some((t) => (t.match(/\p{L}/gu) ?? []).length >= 2);
  if (!hasWord) return null;

  return shape.join(" ");
}

/** مفتاح الذاكرة لنوعٍ وقيمة — موضعٌ واحد، فلا يفترق الكاتب عن القارئ. */
export function memoryKeyFor(kind: IdentityKind, normalized: string): string {
  switch (kind) {
    case "ACCOUNT":
    case "IBAN": return `ACC:${normalized}`;
    case "NATIONAL_ID": return `ID:${normalized}`;
    case "MERCHANT_ID": return `POS:${normalized}`;
    case "NAME": return `NAME:${normalized}`;
    case "PATTERN": return `PAT:${normalized}`;
  }
}

const LABEL: Record<IdentityKind, string> = {
  ACCOUNT: "رقم الحساب",
  IBAN: "الآيبان",
  NATIONAL_ID: "رقم الهوية",
  MERCHANT_ID: "رقم التاجر",
  NAME: "اسم المستفيد",
  PATTERN: "نمط الوصف",
};

/**
 * كل ما يدلّ على جهة هذه الحركة، **مرتّباً من الأقطع إلى الأظنّ**.
 *
 * والترتيب هو الحكم: من عُرف حسابه لا يُبحَث عنه بنمطه. وهذه القائمة
 * هي نفسها التي تُحفَظ عند التأكيد وتُقرأ عند التصنيف — فلا يحفظ
 * الكاتبُ شيئاً ويبحث القارئُ عن غيره.
 */
export function identitiesOf(tx: CanonicalTransaction): Identity[] {
  const out: Identity[] = [];
  const seen = new Set<string>();

  const push = (kind: IdentityKind, value: string) => {
    const normalized = normalizeText(value).toUpperCase();
    if (normalized.length < 3) return;
    const key = memoryKeyFor(kind, normalized);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value, normalized, key, label: LABEL[kind] });
  };

  for (const r of tx.references) {
    if (r.kind === "ACCOUNT") push("ACCOUNT", r.value);
    if (r.kind === "IBAN") push("IBAN", r.value);
  }
  for (const r of tx.references) {
    if (r.kind === "NATIONAL_ID") push("NATIONAL_ID", r.value);
  }
  if (tx.pos?.merchantId) push("MERCHANT_ID", tx.pos.merchantId);

  const name = tx.beneficiaryRaw?.trim();
  if (name) push("NAME", name);

  const sig = signatureOf(tx);
  if (sig) push("PATTERN", sig);

  return out;
}

/**
 * الهويّة التي تُجمَع بها الحركات المتشابهة.
 *
 * أقطعُ ما وُجد. وحين لا يوجد شيء تُرجَع `null` — ولا تُلفَّق مجموعة
 * من حركاتٍ لا يجمعها إلّا أنّنا لم نعرفها.
 */
export function groupingIdentity(tx: CanonicalTransaction): Identity | null {
  return identitiesOf(tx)[0] ?? null;
}

export interface TxGroup<T> {
  /** مفتاح الذاكرة — وهو معرّف المجموعة. */
  key: string;
  identity: Identity;
  items: T[];
  totalMinor: number;
}

/**
 * يجمع المتشابه.
 *
 * والغرض ليس ترتيب الشاشة: هو أن يُسأل الإنسان سؤالاً واحداً عن سبع
 * حركات بدل سبعة أسئلة. وما لا هويّة له يُردّ على حدة — يُعرَض ولا
 * يُدسّ في مجموعةٍ يُطبَّق عليها قرارٌ ليس له.
 */
export function groupByIdentity<T>(
  rows: readonly T[],
  toTx: (row: T) => CanonicalTransaction,
  amountOf: (row: T) => number,
): { groups: TxGroup<T>[]; ungrouped: T[] } {
  const groups = new Map<string, TxGroup<T>>();
  const ungrouped: T[] = [];

  for (const row of rows) {
    const identity = groupingIdentity(toTx(row));
    if (!identity) { ungrouped.push(row); continue; }

    const g = groups.get(identity.key)
      ?? { key: identity.key, identity, items: [], totalMinor: 0 };
    g.items.push(row);
    g.totalMinor += amountOf(row);
    groups.set(identity.key, g);
  }

  /*
    الترتيب بالعدد ثمّ بالمبلغ: المجموعة التي تحسم سبع حركات تسبق
    التي تحسم واحدة، فيقصر الطابور بأسرع ما يمكن.
  */
  const sorted = [...groups.values()].sort(
    (a, b) => b.items.length - a.items.length || b.totalMinor - a.totalMinor,
  );

  return { groups: sorted, ungrouped };
}
