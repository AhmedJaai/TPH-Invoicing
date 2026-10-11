/**
 * سؤالٌ بالكلمات في لوحة الأوامر — «كم دفعتُ للمراعي في سبتمبر؟»
 *
 * محلّلٌ **حتميّ** لا نموذجَ لغويّ: كلماتٌ ثابتة تقول نوعَ السؤال (دفعتُ · اشتريتُ ·
 * عليّ)، وشهرٌ باسمه، وما بقي اسمُ مورّدٍ يطابقه الخادمُ بأسمائه المسجّلة. والرقمُ
 * من الخادم دائماً (`ask.service.ts`)؛ وما لا يُفهَم ليس سؤالاً فيمضي البحثُ كما كان،
 * واسمٌ يحتمل مورّدَين يُسأل عنه ولا يُخمَّن.
 */
import { normalizeArabic, normalizeDigits } from "./search";

export type AskKind = "PAID" | "BOUGHT" | "OWED";

export interface Question {
  kind: AskKind;
  /** YYYY-MM — و`null` «منذ البداية». */
  month: string | null;
  /** ما بقي بعد كلمات السؤال والشهر — مطبَّعاً، يُطابَق به اسمُ المورّد. */
  supplierText: string;
}

const KIND_WORDS: readonly (readonly [AskKind, readonly string[]])[] = [
  ["PAID", ["دفعت", "دفعنا", "سددت", "سددنا", "حولت", "حولنا"]],
  ["BOUGHT", ["اشتريت", "اشترينا", "شريت", "مشتريات", "مشترياتي"]],
  ["OWED", ["علي", "ادين", "باقي", "مستحق", "عليا"]],
];

const MONTHS = ["يناير", "فبراير", "مارس", "ابريل", "مايو", "يونيو", "يوليو", "اغسطس", "سبتمبر", "اكتوبر", "نوفمبر", "ديسمبر"];

/** كلماتٌ تربط ولا تسمّي — تُسقَط قبل قراءة اسم المورّد. */
const FILLER = new Set(["كم", "في", "من", "الى", "عند", "على", "عن", "ل", "لل", "شهر", "هذا", "الشهر", "الماضي", "ريال", "ريالا", "؟", "?", "له", "لهم", "انا", "حق", "مع"]);

function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** `currentMonth` بصيغة YYYY-MM (بتوقيت الرياض) — به يُفهَم «هذا الشهر» و«سبتمبر» بلا سنة. */
export function parseQuestion(raw: string, currentMonth: string): Question | null {
  const text = normalizeArabic(normalizeDigits(raw)).replace(/[؟?،,.]/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  if (words[0] !== "كم" || words.length < 2) return null;

  const kind = KIND_WORDS.find(([, list]) => words.some((w) => list.includes(w)))?.[0];
  if (!kind) return null;

  let month: string | null = null;
  const used = new Set<number>();
  words.forEach((w, i) => {
    if (KIND_WORDS.some(([, list]) => list.includes(w))) used.add(i);
    const iso = /^(\d{4})-(\d{2})$/.exec(w);
    if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) { month = w; used.add(i); return; }
    const at = MONTHS.indexOf(w);
    if (at === -1) return;
    used.add(i);
    const year = /^\d{4}$/.test(words[i + 1] ?? "") ? Number(words[i + 1]) : null;
    if (year !== null) used.add(i + 1);
    const mm = String(at + 1).padStart(2, "0");
    /* شهرٌ بلا سنة: آخرُ مرّةٍ مرّ — «ديسمبر» في يناير هو ديسمبر الماضي لا القادم */
    const thisYear = `${currentMonth.slice(0, 4)}-${mm}`;
    month = year !== null ? `${year}-${mm}` : thisYear <= currentMonth ? thisYear : `${Number(currentMonth.slice(0, 4)) - 1}-${mm}`;
  });
  if (month === null && text.includes("هذا الشهر")) month = currentMonth;
  if (month === null && text.includes("الشهر الماضي")) month = shiftMonth(currentMonth, -1);

  const name = words
    .filter((w, i) => !used.has(i) && !FILLER.has(w))
    /* «للمراعي» = «ل» + «المراعي»، و«لبيكوف» تبقى: حرفُ الجرّ لا يُنزَع من اسمٍ يبدأ به */
    .map((w) => (w.startsWith("لل") && w.length > 3 ? `ال${w.slice(2)}` : w))
    .join(" ")
    .trim();
  if (name.length < 2) return null;
  return { kind, month, supplierText: name };
}

/** أيُّ المورّدين يقصد؟ — بالاسم المطبَّع وأسمائه البديلة. واحدٌ يُجاب، وأكثرُ يُسأل، ولا أحدَ «لم يُعرف». */
export function matchSuppliersByText<T extends { names: readonly string[] }>(suppliers: readonly T[], supplierText: string): T[] {
  const needle = normalizeArabic(supplierText);
  const bare = needle.startsWith("ال") ? needle.slice(2) : needle;
  const exact = suppliers.filter((s) => s.names.some((n) => normalizeArabic(n) === needle));
  if (exact.length > 0) return exact;
  return suppliers.filter((s) => s.names.some((n) => {
    const name = normalizeArabic(n);
    return name.includes(needle) || (bare.length >= 3 && name.includes(bare));
  }));
}

/**
 * يحاول الاسمَ كما كُتب، ثمّ بلا لام الجرّ **حين لا يطابق شيءٌ وحده**: «لبيكوف»
 * تجد «بيكوف»، ومورّدٌ اسمُه يبدأ باللام لا يُسلَب حرفَه.
 */
export function resolveAskedSupplier<T extends { names: readonly string[] }>(suppliers: readonly T[], supplierText: string): T[] {
  const direct = matchSuppliersByText(suppliers, supplierText);
  if (direct.length > 0 || !supplierText.startsWith("ل") || supplierText.length < 4) return direct;
  return matchSuppliersByText(suppliers, supplierText.slice(1));
}
