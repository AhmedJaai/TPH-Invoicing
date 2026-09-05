/**
 * تعريف المستفيد.
 *
 * كان النظام يبحث عن اسم المورّد داخل نصّ الحركة، فيعرفه إن تشابه
 * النصّان ويجهله إن اختلفا. و«شركة أنس غالب حمزة خاشقجي التجارية
 * المحدودة» في البنك هي «Ganache» في فواتيرك — ولا حرف مشترك بينهما.
 *
 * فالتعريف هنا يجمع أدلّةً من أنواع مختلفة، ولكلٍّ وزنه وقوّته:
 *
 *   الحساب أو الآيبان  — قاطع، لا يُكتب بصيغتين.
 *   الاسم البديل المؤكَّد — قاطع، أكّده إنسان.
 *   رقم الهوية         — قاطع للأشخاص.
 *   تطابق الاسم        — قويّ.
 *   كلمة مميّزة        — ظنّيّ، ولا يكفي وحده.
 *
 * ولا يُقبَل دليلٌ ظنّيّ وحيد: المطابقة الخاطئة في المال أغلى من غيابها.
 */
import type { CanonicalTransaction } from "./canonical";
import { normalizeText } from "./canonical";

export interface SupplierIdentity {
  supplierId: string;
  nameAr: string;
  slug: string;
  nameEn?: string | null;
  driveFolderName?: string | null;
  /** أسماء بديلة أكّدها إنسان. */
  aliases: readonly string[];
  /** حسابات أو آيبانات عُرف أنّها له. */
  accounts?: readonly string[];
}

export type EvidenceKind = "ACCOUNT" | "ALIAS" | "NATIONAL_ID" | "NAME" | "TOKEN";

export interface Evidence {
  kind: EvidenceKind;
  detail: string;
  weight: number;
  /** هل يكفي وحده لتعريف المستفيد؟ */
  decisive: boolean;
}

export interface Resolution {
  supplierId: string;
  score: number;
  evidence: Evidence[];
}

const WEIGHT: Record<EvidenceKind, number> = {
  ACCOUNT: 1,
  ALIAS: 0.95,
  NATIONAL_ID: 0.9,
  NAME: 0.8,
  TOKEN: 0.45,
};

const DECISIVE: readonly EvidenceKind[] = ["ACCOUNT", "ALIAS", "NATIONAL_ID"];

/** أقصر كلمة يُعتدّ بها عادةً — ما دونها يقع بالمصادفة. */
export const MIN_TOKEN = 4;

/**
 * وأقصر منها حين لا يبقى في الاسم سواها.
 *
 * «سرد للتجارة»: «للتجاره» كلمةٌ عامّة لا تميّز أحداً، و«سرد» ثلاثة
 * أحرف فتسقط بالحدّ — فيبقى الاسم بلا كلمةٍ مميّزة واحدة، ولا يُطابَق
 * أبداً. وهذا سببُ عجز مطابقةِ دفعةٍ بأحد عشر ألفاً في بيانات أحمد.
 *
 * وكثيرٌ من أسماء التجارة العربية ثلاثيّة: سرد · لافا · بدر · نور.
 * فيُقبَل الثلاثيّ **حين لا يوجد أطول منه** — لا مطلقاً، كي لا تكثر
 * المصادفات.
 */
export const MIN_TOKEN_FALLBACK = 3;

/** كلمات تتكرّر في أسماء الشركات فلا تميّز أحداً. */
const STOPWORDS = new Set([
  "شركه", "مؤسسه", "مؤسسة", "التجاريه", "التجارية", "المحدوده", "المحدودة",
  "للتجاره", "العامه", "الوطنيه", "السعوديه", "العربيه", "مجموعه", "فرع",
  "company", "trading", "limited", "establishment", "group", "branch",
  "الاهلي", "مرجع", "السداد", "تحويل", "حواله", "صادره", "محليه",
  "reference", "monthly", "salary", "transfer", "local",
]);

export function distinctiveTokens(name: string): string[] {
  const words = normalizeText(name)
    .split(/[\s\-_/،,.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t.toLowerCase()));

  const long = words.filter((t) => t.length >= MIN_TOKEN);
  if (long.length > 0) return long;

  // لا كلمة طويلة مميّزة: يُقبَل الثلاثيّ كي لا يبقى الاسم بلا هوية
  return words.filter((t) => t.length >= MIN_TOKEN_FALLBACK);
}

/** يُطابَق على حدود الكلمات لا بالاحتواء — «jar» داخل «EJAR» ليست مطابقة. */
export function tokenAppears(token: string, text: string): boolean {
  const t = normalizeText(token);
  if (t.length < MIN_TOKEN_FALLBACK) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

/**
 * يعرّف مستفيد الحركة.
 *
 * يُرجَع أفضل تعريف مع أدلّته — و`null` حين لا يكفي الدليل. والفارق
 * بين «لم أجد» و«وجدتُ ضعيفاً» محفوظ: الضعيف يُعرَض ولا يُعتمَد.
 */
export function resolveSupplier(
  tx: CanonicalTransaction,
  suppliers: readonly SupplierIdentity[],
): Resolution | null {
  const text = tx.searchText;
  if (text.length === 0) return null;

  const accounts = new Set(
    tx.references.filter((r) => r.kind === "ACCOUNT" || r.kind === "IBAN").map((r) => r.value),
  );
  const ids = new Set(tx.references.filter((r) => r.kind === "NATIONAL_ID").map((r) => r.value));

  const results: Resolution[] = [];

  for (const s of suppliers) {
    const evidence: Evidence[] = [];

    for (const acc of s.accounts ?? []) {
      if (accounts.has(acc)) {
        evidence.push({ kind: "ACCOUNT", detail: `الحساب ${acc} معروف أنّه له`, weight: WEIGHT.ACCOUNT, decisive: true });
      }
    }

    for (const alias of s.aliases) {
      if (alias.trim().length === 0) continue;
      if (tokenAppears(alias, text) || text.includes(normalizeText(alias))) {
        evidence.push({ kind: "ALIAS", detail: `الاسم البديل «${alias}» أكّدتَه من قبل`, weight: WEIGHT.ALIAS, decisive: true });
        break;
      }
    }

    for (const id of ids) {
      if ((s.accounts ?? []).includes(id)) {
        evidence.push({ kind: "NATIONAL_ID", detail: `رقم الهوية ${id} معروف`, weight: WEIGHT.NATIONAL_ID, decisive: true });
      }
    }

    for (const name of [s.nameAr, s.nameEn, s.driveFolderName, s.slug]) {
      if (!name) continue;
      const n = normalizeText(name);
      if (n.length >= MIN_TOKEN && text.includes(n)) {
        evidence.push({ kind: "NAME", detail: `اسم المورّد «${name}» وارد كما هو`, weight: WEIGHT.NAME, decisive: false });
        break;
      }
    }

    const tokens = distinctiveTokens(s.nameAr).filter((t) => tokenAppears(t, text));
    if (tokens.length > 0) {
      evidence.push({
        kind: "TOKEN",
        detail: `كلمة مميّزة: ${tokens.join(" · ")}`,
        // كلمتان مميّزتان أقوى من واحدة، ولا تبلغان القاطع
        weight: Math.min(WEIGHT.TOKEN + 0.2 * (tokens.length - 1), 0.75),
        decisive: false,
      });
    }

    if (evidence.length === 0) continue;

    /*
      الدليل القاطع يحسم وحده. وما دونه لا يكفي منفرداً إن كان ظنّياً —
      كلمةٌ واحدة مميّزة قد تقع في اسم مورّدين.
    */
    const hasDecisive = evidence.some((e) => DECISIVE.includes(e.kind));
    const onlyToken = evidence.length === 1 && evidence[0].kind === "TOKEN";
    if (!hasDecisive && onlyToken && evidence[0].weight < 0.6) continue;

    results.push({
      supplierId: s.supplierId,
      score: Math.min(1, Math.max(...evidence.map((e) => e.weight))),
      evidence,
    });
  }

  if (results.length === 0) return null;

  results.sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length);

  /*
    مورّدان بنفس القوّة تعريفٌ لا يُعتمَد: النظام لا يعرف أيّهما. ويُرجَع
    الأوّل بدرجةٍ مخفوضة كي يُعرَض اقتراحاً لا يُطابَق تلقائياً.
    */
  if (results.length > 1 && results[1].score >= results[0].score) {
    return { ...results[0], score: results[0].score * 0.6,
      evidence: [...results[0].evidence,
        { kind: "TOKEN", detail: "مورّدٌ آخر يطابق بنفس القوّة — لا يُحسم", weight: 0, decisive: false }] };
  }

  return results[0];
}
