/**
 * القراءةُ الذكيّة — **النموذج يقرأ ولا يحسب**.
 *
 * الخادمُ يحسب الأرقامَ والفروق بشيفرةٍ حتميّة ويُعطيها النموذجَ «حقائقَ» مرقَّمة
 * (`ح١`، `ح٢`…). والنموذجُ يكتب جُملاً قصيرة، كلُّ جملةٍ تسمّي الحقائقَ التي قامت عليها.
 * ثمّ يتحقّق الخادم: كلُّ رقمٍ في الجملة يجب أن يكون قيمةَ حقيقةٍ ممّا أُعطي — **وما لم
 * يوجد تسقط جملتُه**. فلا يبلغ الشاشةَ رقمٌ اخترعه نموذج.
 *
 * والشهرُ الناقص يُقال للنموذج ناقصاً باسم ما ينقصه؛ والقراءةُ تُعرَض «قراءةً واقتراحاً»
 * لا حكماً، وتُحفَظ بمدخلاتها وبصمتها فلا يُعاد توليدُها عند كلّ فتح.
 *
 * نقيّ: لا نداءَ هنا ولا قاعدة.
 */
import { createHash } from "node:crypto";
import { latinDigits } from "@/lib/digits";

export const READING_PROMPT_VERSION = "finance-reading-2";

export type FactKind = "SAR" | "PCT" | "COUNT" | "NOTE";

export interface Fact {
  /** `F1`… — ثابتٌ داخل القراءة الواحدة. */
  id: string;
  label: string;
  kind: FactKind;
  /** ريالاتٌ صحيحة، أو نسبةٌ بخانةٍ عشريّة، أو عدد. `null` لحقيقةٍ نصّيّة أو قيمةٍ غير معروفة. */
  value: number | null;
  /** لحقيقةٍ نصّيّة («ينقص الشهرَ الإيجار») أو لقيمةٍ غير معروفة. */
  note?: string;
}

export class FactList {
  readonly facts: Fact[] = [];
  private add(label: string, kind: FactKind, value: number | null, note?: string): void {
    this.facts.push({ id: `F${this.facts.length + 1}`, label, kind, value, note });
  }
  /** مبلغٌ بالهللات ← ريالاتٌ صحيحة. `null` «غير معروف» ويُقال. */
  sar(label: string, minor: number | null): void {
    this.add(label, "SAR", minor === null ? null : Math.round(minor / 100), minor === null ? "غير معروف" : undefined);
  }
  /** نسبةٌ بنقاط الأساس ← بخانةٍ عشريّة. */
  pct(label: string, bp: number | null): void {
    this.add(label, "PCT", bp === null ? null : Math.round(bp / 10) / 10, bp === null ? "غير معروف" : undefined);
  }
  count(label: string, n: number | null): void {
    this.add(label, "COUNT", n, n === null ? "غير معروف" : undefined);
  }
  note(label: string, text: string): void {
    this.add(label, "NOTE", null, text);
  }
}

export function factsHash(facts: readonly Fact[]): string {
  return createHash("sha256").update(JSON.stringify([READING_PROMPT_VERSION, facts.map((f) => [f.label, f.kind, f.value, f.note ?? ""])])).digest("hex");
}

export type ReadingSection = "CHANGED" | "WHY" | "DO";

export const SECTION_LABEL: Record<ReadingSection, string> = {
  CHANGED: "أهمُّ ما تغيّر",
  WHY: "السببُ المرجَّح",
  DO: "ما يُقترَح فعلُه",
};

export interface ReadingSentence {
  section: ReadingSection;
  text: string;
  /** الحقائقُ التي قامت عليها — تُعرَض بجانبها وتُنقَر. */
  facts: string[];
}

/** دون هذا العدد من الجُمل، أو بقسمٍ فارغ، تُعاد المحاولةُ مرّةً ويُؤخَذ الأوفى. */
export const READING_MIN_SENTENCES = 5;

/** أتكفي القراءةُ لتُعرَض؟ — كلُّ قسمٍ فيه جملة، والمجموعُ فوق الحدّ. */
export function readingIsFull(reading: Reading): boolean {
  const sections = new Set(reading.sentences.map((s) => s.section));
  return reading.sentences.length >= READING_MIN_SENTENCES && sections.size === 3;
}

export interface Reading {
  sentences: ReadingSentence[];
  /** جُملٌ أُسقطت لأنّ فيها رقماً ليس ممّا أُعطي — تُعدّ ولا تُعرَض. */
  dropped: number;
}

const MONTH_NAMES = "يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر";
const MONTH_YEAR = new RegExp(`(${MONTH_NAMES})\\s+20\\d\\d`, "g");

/**
 * الأرقامُ في نصّ: بالأرقام اللاتينيّة أو العربيّة، بفواصل الآلاف والكسور.
 *
 * ولا يُعدّ رقماً ما ليس قياساً: السنةُ بعد اسم شهرها («سبتمبر 2026»)، وما في اسم صنفٍ
 * بين «» («كاسات ١٢ اونص»)، وما التصق بحرفٍ لاتينيّ («V60») — جُرّب على أوّل قراءة
 * حقيقيّة فأسقطت السنةُ تسعَ جُملٍ صحيحةٍ من عشر.
 */
export function numbersIn(text: string): number[] {
  const latin = latinDigits(text)
    .replace(/«[^»]*»/g, " ")
    .replace(MONTH_YEAR, "$1")
    .replace(/[A-Za-z][A-Za-z\d]*\d[A-Za-z\d]*/g, " ")
    .replace(/[٬،](?=\d{3})/g, "").replace(/٫/g, ".");
  const out: number[] = [];
  for (const m of latin.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** أعدادٌ صغيرة تُكتب عدّاً لا قياساً («ثلاثة أشهر» بالأرقام) — لا تُعدّ ادّعاءً ماليّاً. */
const SMALL_COUNT = 12;

/** أتطابق القيمةُ المذكورة حقيقةً؟ المبلغُ بالريال الصحيح، والنسبةُ بخانةٍ أو مقرَّبةً. */
function matchesFact(n: number, fact: Fact): boolean {
  if (fact.value === null) return false;
  const v = Math.abs(fact.value);
  if (fact.kind === "PCT") return Math.abs(n - v) < 0.051 || n === Math.round(v);
  return n === v;
}

/**
 * يتحقّق من جواب النموذج: الشكلُ أوّلاً، ثمّ كلُّ جملةٍ برقمها.
 *
 * كلُّ رقمٍ في الجملة يجب أن يكون قيمةَ حقيقةٍ **ممّا أُعطي** — من الحقائق التي سمّتها
 * أوّلاً، وإلّا من غيرها فتُضاف إلى ما تُربَط به الجملة (النموذجُ ينسى أن يسمّي حقيقةً
 * ذكر رقمَها؛ والرقمُ صحيحٌ وأصلُه معروف). وما لا أصلَ له في الحقائق كلِّها **يُسقط
 * جملتَه**، وكذلك حقيقةٌ مسمّاة لا وجود لها.
 */
export function validateReading(raw: unknown, facts: readonly Fact[]): Reading {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const sentences: ReadingSentence[] = [];
  let dropped = 0;
  const list = typeof raw === "object" && raw !== null && Array.isArray((raw as { sentences?: unknown }).sentences)
    ? (raw as { sentences: unknown[] }).sentences : [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) { dropped++; continue; }
    const { section, text, facts: cited } = item as { section?: unknown; text?: unknown; facts?: unknown };
    if ((section !== "CHANGED" && section !== "WHY" && section !== "DO") || typeof text !== "string" || text.trim() === "" || text.length > 400) { dropped++; continue; }
    const ids = Array.isArray(cited) ? cited.filter((x): x is string => typeof x === "string") : [];
    const citedFacts = ids.map((id) => byId.get(id));
    if (citedFacts.some((f) => f === undefined)) { dropped++; continue; }
    const linked = new Set(ids);
    const known = citedFacts.flatMap((f) => (f ? [f] : []));
    const numbers = numbersIn(text).filter((n) => !(Number.isInteger(n) && n <= SMALL_COUNT));
    let invented = false;
    for (const n of numbers) {
      if (known.some((f) => matchesFact(n, f))) continue;
      const origin = facts.find((f) => matchesFact(n, f));
      if (!origin) { invented = true; break; }
      linked.add(origin.id);
    }
    if (invented) { dropped++; continue; }
    sentences.push({ section, text: text.trim(), facts: [...linked] });
  }
  return { sentences, dropped };
}

export function buildReadingMessages(monthLabel: string, facts: readonly Fact[]): { system: string; user: string } {
  const system = [
    "أنت قارئٌ ماليّ لصاحب مقهى واحد في جدّة يفتح تطبيقَه آخرَ الشهر ويسأل: هل ربحتُ، ولماذا؟ تُعطى حقائقَ حسبها الخادم عن شهرٍ بعينه، مرقَّمةً F1 وF2…",
    "اكتب قراءةً قصيرة بالعربيّة الفصحى السهلة. لا تحسب شيئاً: كلُّ رقمٍ تذكره يجب أن يكون قيمةَ حقيقةٍ كما هي، بلا جمعٍ ولا طرحٍ ولا تقريبٍ ولا نسبةٍ تشتقّها.",
    "قواعد:",
    "- كلُّ جملةٍ تسمّي في `facts` معرّفاتِ الحقائق التي قامت عليها. جملةٌ فيها رقمٌ ليس في حقائقها تُحذَف.",
    "- اكتب المبالغ بالريال أرقاماً صحيحة كما وردت، والنِّسب كما وردت، ولا تكتب السنة.",
    "- لا تُعِد قراءةَ رقمٍ واحد («الإيراد بلغ كذا») — صاحبُ المقهى يراه فوقك. كلُّ جملةٍ تربط حقيقتين فأكثر أو تقول ما معنى الرقم له.",
    "- قارِن بـ«متوسّط الأشهر الثلاثة السابقة» حيث وُجد لا بالشهر السابق وحده: شهرٌ واحد قد يكون شاذّاً (فاتورةٌ دُفعت مرّتين، أو لم تُدفَع).",
    "- إن قالت حقيقةٌ إنّ الشهر ناقصٌ أو إنّ رقماً «غير معروف» فقل ذلك صراحةً في أوّل قسم CHANGED، ولا تسمِّ الناقصَ ربحاً ولا تبنِ عليه حكماً.",
    "- كن محدَّداً بهذا المقهى: سمِّ الصنفَ والفئة. جملةٌ تصلح لأيّ مقهى («راقِب التكاليف»، «حسِّن الهوامش الضعيفة») لا تُكتب.",
    "- صِف ما حدث ولا تتّهم أحداً: «فرقٌ غير مفسَّر» لا «سرقة».",
    "- السببُ «مرجَّح» لا مؤكَّد: قل «قد» و«يُرجَّح». ولا تخترع سبباً لا تسنده حقيقة.",
    "- ثلاثةُ أقسام، وفي كلٍّ جملتان على الأقلّ: CHANGED (أهمّ ما تغيّر، حتى أربع جمل) · WHY (السبب المرجَّح، حتى ثلاث) · DO (حتى ثلاث).",
    "- لا تجمع رقمَين ولا تطرحهما: إن ذكرتَ صنفين فاذكر رقمَ كلٍّ منهما كما ورد. جملةٌ فيها مجموعٌ حسبتَه تُحذَف.",
    "- DO: فعلٌ واحد محدَّد في كلّ جملة. قدِّم ما وُسم في الحقائق بـ«إجراءٌ متاح» — هو فعلٌ يقدر عليه صاحبُ المقهى في التطبيق الآن — ثمّ سؤالاً محدَّداً يُسأل في المقهى.",
    'أجِب بـJSON وحده: {"sentences":[{"section":"CHANGED","text":"…","facts":["F1","F4"]}]}',
  ].join("\n");
  const lines = facts.map((f) => {
    const value = f.kind === "NOTE" ? f.note ?? "" : f.value === null ? "غير معروف" : f.kind === "SAR" ? `${f.value} ريال` : f.kind === "PCT" ? `${f.value}٪` : String(f.value);
    return `${f.id} | ${f.label}: ${value}`;
  });
  return { system, user: `حقائقُ ${monthLabel}:\n${lines.join("\n")}` };
}
