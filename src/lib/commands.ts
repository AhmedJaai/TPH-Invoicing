/**
 * لوحةُ الأوامر: «أين أذهب؟» و«ماذا أفعل؟» من موضعٍ واحد.
 *
 * كان البحث يجد السجلّات (فاتورة · مورّد · حركة) ولا يجد **الصفحات ولا
 * الأفعال**. فمن أراد «إقفال الشهر» أو «استيراد كشف» كان عليه أن يتذكّر
 * في أيّ مساحةٍ يقع، ثمّ في أيّ لسان — وهو بالضبط ما لا يريد أن يحمله
 * في رأسه. فصارت الأوامر قائمةً تُكتب فيها كلمةٌ من الفعل فيظهر.
 *
 * والقائمةُ **تُشتقّ من نموذج التنقّل** (`nav.ts`) ولا تُنسَخ منه: صفحةٌ
 * تُضاف إلى المساحات تظهر هنا بلا سطرٍ آخر، ولا يبقى أمرٌ يشير إلى صفحةٍ
 * حُذفت. وما يُضاف هنا يدوياً اثنان فقط: الأفعال، والصفحات التي تُفتَح
 * من موضعها لا من الألسنة.
 *
 * والصلاحيّةُ تُطبَّق هنا كما تُطبَّق في الشريط — أمرٌ لا يملكه الدور لا
 * يُعرَض، لأنّ عرضه ثمّ ردَّه بـ«لا صلاحية» زرٌّ لا يعمل. (والخادمُ يحرس
 * الصفحة نفسها في كلّ حال؛ هذا عرضٌ لا حراسة.)
 *
 * دالّةٌ خالصة — لا قاعدة ولا متصفّح — فتُختبَر.
 */
import { AREAS, ACCOUNT_LINKS } from "./nav";
import { can, type Capability, type Role } from "./permissions";
import { normalizeArabic, normalizeDigits } from "./search";

export type CommandGroup = "ACTION" | "PAGE";

export const COMMAND_GROUP_LABEL: Record<CommandGroup, string> = {
  ACTION: "افعل",
  PAGE: "انتقل إلى",
};

export interface Command {
  id: string;
  label: string;
  /** سطرٌ ثانٍ يقول أين يقع أو ماذا يفعل. */
  hint?: string;
  group: CommandGroup;
  href: string;
  needs?: Capability;
  /** كلماتٌ يكتبها الناس ولا تقع في الاسم — «سداد» لـ«دفعة الشهر». */
  keywords?: readonly string[];
}

/**
 * الأفعال — ما يُفعَل كلّ يومٍ أو كلّ أسبوع.
 *
 * كلٌّ منها يفتح الموضع الذي يقع فيه الفعل **عند الفعل نفسه**: استيرادُ
 * الكشف يفتح قسمَ الاستيراد لا رأسَ صفحة البنك.
 */
const ACTIONS: readonly Command[] = [
  {
    id: "upload",
    label: "ارفع فاتورة أو مستنداً",
    hint: "يقرؤه النظام ويعرضه عليك قبل الحفظ",
    group: "ACTION",
    href: "/upload",
    needs: "document:upload",
    keywords: ["رفع", "فاتوره", "ايصال", "صوره", "مستند", "upload", "invoice"],
  },
  {
    id: "drive-sync",
    label: "افحص الدرايف عن ملفات جديدة",
    hint: "المستندات",
    group: "ACTION",
    href: "/upload",
    needs: "document:upload",
    keywords: ["درايف", "مزامنه", "drive", "sync", "جوجل"],
  },
  {
    id: "bank-import",
    label: "استورد كشف البنك",
    hint: "حركة البنك",
    group: "ACTION",
    href: "/bank#import",
    needs: "bank:edit",
    keywords: ["كشف", "بنك", "اهلي", "استيراد", "statement", "bank"],
  },
  {
    id: "decide",
    label: "راجع ما ينتظر قرارك",
    hint: "كلّ بندٍ بسببه ودليله وفعله",
    group: "ACTION",
    href: "/attention",
    needs: "reports:view",
    keywords: ["تنبيه", "مراجعه", "قرار", "attention", "review"],
  },
  {
    id: "pay-run",
    label: "جهّز دفعة الشهر للمورّدين",
    hint: "ملفّ تحويلاتٍ بما عليك لكلّ مورّد",
    group: "ACTION",
    href: "/payments",
    needs: "payment:approve",
    keywords: ["سداد", "تحويل", "دفع", "دفعه", "pay", "payment"],
  },
  {
    id: "close-month",
    label: "أقفل الشهر",
    hint: "المعادلة والكشوف قبل الإقفال",
    group: "ACTION",
    href: "/close",
    needs: "month:close",
    keywords: ["اقفال", "شهر", "close"],
  },
  {
    id: "count",
    label: "ابدأ جرد الأسبوع",
    hint: "الجرد",
    group: "ACTION",
    href: "/inventory",
    needs: "inventory:count",
    keywords: ["جرد", "عد", "مخزون", "count", "inventory"],
  },
  {
    id: "sales-import",
    label: "استورد مبيعات فودكس أو الكتالوج",
    hint: "الجرد",
    group: "ACTION",
    href: "/inventory/import",
    needs: "inventory:count",
    keywords: ["فودكس", "مبيعات", "كتالوج", "foodics", "sales", "اكسل"],
  },
  {
    id: "statements",
    label: "طابِق كشف مورّد",
    hint: "الكشوف",
    group: "ACTION",
    href: "/statements",
    needs: "supplier:view",
    keywords: ["كشف", "مورد", "مطابقه", "statement"],
  },
];

/**
 * صفحاتٌ تُفتَح من موضعها لا من الألسنة — فلا يجدها من لا يعرف موضعها
 * إلّا هنا. وكلٌّ منها يُحرَس بما تحرسه به صفحتُه.
 */
const SECONDARY: readonly Command[] = [
  { id: "p:analysis", label: "الأصناف والأسعار", hint: "المورّدون", group: "PAGE", href: "/analysis", needs: "amounts:view", keywords: ["سعر", "اسعار", "صنف", "prices"] },
  { id: "p:expenses", label: "المصروفات", hint: "المال", group: "PAGE", href: "/money/expenses", needs: "bank:view", keywords: ["مصروف", "ايجار", "رواتب", "expenses"] },
  { id: "p:trend", label: "اتّجاه الجرد", hint: "الجرد", group: "PAGE", href: "/inventory/trend", needs: "amounts:view", keywords: ["فرق", "اتجاه", "trend"] },
  { id: "p:mapping", label: "منتجات تحتاج ربطاً", hint: "الجرد", group: "PAGE", href: "/inventory/mapping", needs: "inventory:view", keywords: ["ربط", "منتج", "mapping"] },
];

/** الصفحاتُ من نموذج التنقّل — المساحةُ وألسنتُها وروابطُ الحساب. */
function pageCommands(): Command[] {
  const out: Command[] = [];
  const seen = new Set<string>();
  const push = (c: Command) => {
    if (seen.has(c.href)) return;
    seen.add(c.href);
    out.push(c);
  };

  for (const area of AREAS) {
    if (area.children.length === 0) {
      push({ id: `p:${area.href}`, label: area.label, group: "PAGE", href: area.href, needs: area.needs });
      continue;
    }
    for (const child of area.children) {
      push({
        id: `p:${child.href}`,
        // لسانٌ اسمُه اسمُ مساحته يُقال مرّةً: «الجرد الحالي» لا «الجرد · الجرد الحالي»
        label: child.label,
        hint: child.label === area.label ? undefined : area.label,
        group: "PAGE",
        href: child.href,
        // اللسانُ يرث حارسَ مساحته — لا يُعرض لسانٌ في مساحةٍ مغلقة
        needs: child.needs ?? area.needs,
      });
    }
  }
  for (const s of SECONDARY) push(s);
  for (const l of ACCOUNT_LINKS) {
    push({ id: `p:${l.href}`, label: l.label, group: "PAGE", href: l.href, needs: l.needs });
  }
  return out;
}

/** كلُّ أمرٍ يملكه الدور — الأفعالُ أوّلاً ثمّ الصفحات. */
export function commandsFor(role: Role): Command[] {
  const pages = pageCommands();
  const areaNeeds = new Map(AREAS.flatMap((a) => a.children.map((c) => [c.href, a.needs] as const)));
  return [...ACTIONS, ...pages].filter((c) => {
    if (c.needs && !can(role, c.needs)) return false;
    // فعلٌ يقع في لسانٍ من مساحةٍ مغلقة لا يُعرض وإن ملك الفعلَ نفسه
    const area = areaNeeds.get(c.href.split("#")[0]);
    return !area || can(role, area);
  });
}

function fold(s: string): string {
  return normalizeArabic(normalizeDigits(s.toLowerCase())).replace(/[ّ]/g, "");
}

/**
 * ترتيبُ الأوامر بما كُتب.
 *
 * كلُّ كلمةٍ من المكتوب يجب أن تقع في الاسم أو التلميح أو الكلمات — «كشف
 * بنك» يجد «استورد كشف البنك» ولا يجد «طابِق كشف مورّد». والبادئةُ أثقل
 * من الاحتواء، والاسمُ أثقل من الكلمات. وعند التساوي يبقى الترتيبُ
 * الأصليّ: الأفعال قبل الصفحات.
 *
 * والفارغُ يُرجع القائمةَ كما هي — اللوحةُ المفتوحة بلا كتابةٍ دليلٌ
 * بما يمكن فعله.
 */
export function matchCommands(query: string, commands: readonly Command[]): Command[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...commands];

  const scored: { c: Command; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const label = fold(c.label);
    const labelWords = label.split(" ");
    const extra = [c.hint ?? "", ...(c.keywords ?? [])].map(fold);
    let score = 0;
    for (const w of words) {
      if (labelWords.some((lw) => lw.startsWith(w) || lw.startsWith(`ال${w}`))) score += 4;
      else if (label.includes(w)) score += 3;
      else if (extra.some((e) => e.split(" ").some((ew) => ew.startsWith(w)))) score += 2;
      else if (extra.some((e) => e.includes(w))) score += 1;
      else return; // كلمةٌ لم تقع في شيء — ليس هذا ما قُصد
    }
    scored.push({ c, score, i });
  });

  /*
    الأفعالُ ثمّ الصفحات، والأقوى داخل كلٍّ أوّلاً. وكان الترتيبُ بالقوّة
    وحدها فتتناوب المجموعتان — «افعل · انتقل إلى · افعل · انتقل إلى» —
    وعنوانُ المجموعة يتكرّر فلا يعود يعني شيئاً.
  */
  const rank = (g: CommandGroup) => (g === "ACTION" ? 0 : 1);
  return scored
    .sort((a, b) => rank(a.c.group) - rank(b.c.group) || b.score - a.score || a.i - b.i)
    .map((s) => s.c);
}
