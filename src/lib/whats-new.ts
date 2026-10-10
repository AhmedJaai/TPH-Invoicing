/**
 * «الجديد في النظام» — ما أُضيف ممّا يراه صاحبُ المقهى، بجملةٍ ورابط.
 *
 * `docs/CHANGELOG.md` للمطوّر؛ وهذا لمن يستعمل. الأحدثُ أوّلاً، ويُعرَض في «اليوم»
 * مرّةً لكلّ بند (حدُّ القراءة في تخزين الجهاز). **يُضاف هنا سطرٌ حين يتغيّر ما يراه
 * المستخدم** — لا لكلّ إيداع.
 */
export interface NewsItem {
  /** معرّفٌ ثابت — به يُحفَظ أنّه قُرئ. */
  id: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
  href: string;
  /** ما يلزم ليُرى — من لا يملكها لا يُعرَض له رابطٌ يُغلَق في وجهه. */
  needs: "payment:approve" | "bank:view" | "document:upload" | "document:view";
}

export const WHATS_NEW: readonly NewsItem[] = [
  { id: "payrun-partial", date: "2026-10-09", needs: "payment:approve", href: "/payments", text: "دفعة الشهر: استثنِ فاتورةً واحدة أو ادفع جزءاً من المبلغ — والمحجوزةُ تدخل الدفعةَ بقرارك وسببك." },
  { id: "cash-what-if", date: "2026-10-09", needs: "bank:view", href: "/cash", text: "النقد القادم: «ماذا لو أجّلتُ هذا؟» — علّم سطراً فترى ما يبقى بعد كلّ مرحلة، ومعه خطُّ الرصيد." },
  { id: "auto-work-told", date: "2026-10-09", needs: "document:upload", href: "/documents/drive#auto", text: "العمل الآليّ يخبرك بما قيّده واعتمده وبكم زاد ما عليك — ويُوقَف ويُشغَّل من صفحة الدرايف." },
  { id: "bank-search", date: "2026-10-09", needs: "bank:view", href: "/bank#transactions", text: "سجلّ البنك: البحثُ بالمبلغ أو الاسم يجري في كلّ الحركات لا في أحدثها وحدها." },
];

/** ما لم يُقرأ بعد ممّا يملك الدورُ رؤيتَه — الأحدثُ أوّلاً. */
export function unseenNews(
  seen: ReadonlySet<string>,
  can: (capability: NewsItem["needs"]) => boolean,
  items: readonly NewsItem[] = WHATS_NEW,
): NewsItem[] {
  return items.filter((n) => !seen.has(n.id) && can(n.needs)).sort((a, b) => b.date.localeCompare(a.date));
}
