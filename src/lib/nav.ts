/**
 * نموذج التنقّل — الإصدار الثاني: أعمالٌ لا جداول، في ثلاث مجموعات.
 *
 *   اليوم      — ما حال المقهى؟ · ما ينتظر قراري؟ · ما الذي وصلني؟
 *   المال      — لمن أدين؟ · ماذا أدفع هذا الأسبوع وهل يكفي النقد؟ ·
 *                أين ذهب المال؟ · هل يُقفَل الشهر؟
 *   التشغيل    — أين ذهب ما اشتريتُه؟
 *
 * كان ستَّ مساحاتٍ تحت كلٍّ منها ألسنة، و«المال» تجمع البنكَ والإقفالَ
 * ودفعةَ الشهر في بابٍ واحد — فيقرأ صاحبُ المقهى «عليك ١٢ ألفاً» ثمّ
 * يبحث عن موضع الدفع. صارت كلُّ وظيفةٍ يوميّةٍ مدخلاً باسمها: المورّدون
 * (لمن أدين)، والدفعات (ماذا أدفع ومتى)، والبنك (ما دخل وما خرج)،
 * والإقفال. والمجموعةُ عنوانٌ يرتّبها لا بابٌ يُفتَح.
 *
 * والألسنةُ داخل الصفحة تحت عنوانها، لا في الشريط.
 * ولوحةُ الأوامر واختصاراتُ `g` تُشتقّ من هنا ولا تُنسَخ.
 */
import { can, type Capability, type Role } from "./permissions";

export interface NavLink {
  href: string;
  label: string;
  needs?: Capability;
}

export type NavGroup = "today" | "money" | "ops";

/** مفتاحُ الأيقونة — يُرسَم في `components/icons.tsx`. */
export type NavIcon =
  | "today" | "decisions" | "documents" | "suppliers" | "payments"
  | "bank" | "close" | "inventory" | "settings" | "audit";

export interface NavArea extends NavLink {
  /** الاسم القصير لشريط الجوّال. */
  short: string;
  icon: NavIcon;
  group: NavGroup;
  /** سطرٌ يقول ما تجيب عنه — يظهر في لوحة الأوامر. */
  question: string;
  /** الحرف بعد `g` — «g ثمّ s» تفتح المورّدين. */
  chord: string;
  /** المسارات التي تنتمي إليها وإن لم تظهر ألسنة. */
  owns: readonly string[];
  /** ألسنةُ الصفحة. واسمُ اللسان هو عنوانُ الصفحة التي يفتحها حرفاً بحرف. */
  children: readonly NavLink[];
}

export const GROUP_LABEL: Record<NavGroup, string | null> = {
  today: null,
  money: "المال",
  ops: "التشغيل",
};

export const AREAS: readonly NavArea[] = [
  {
    href: "/",
    label: "اليوم",
    short: "اليوم",
    icon: "today",
    group: "today",
    question: "ما تحتاج معرفته أو فعله اليوم",
    chord: "h",
    needs: "amounts:view",
    owns: ["/dashboard", "/performance"],
    children: [],
  },
  {
    href: "/attention",
    label: "يحتاج قرارك",
    short: "قرارك",
    icon: "decisions",
    group: "today",
    question: "كلُّ بندٍ بسببه ودليله وفعله",
    chord: "a",
    needs: "reports:view",
    owns: ["/review", "/audit"],
    children: [],
  },
  {
    href: "/documents",
    label: "المستندات",
    short: "المستندات",
    icon: "documents",
    group: "today",
    question: "ما وصلك من فواتير وكشوف وإيصالات",
    chord: "d",
    owns: ["/upload"],
    children: [],
  },
  {
    href: "/suppliers",
    label: "المورّدون",
    short: "المورّدون",
    icon: "suppliers",
    group: "money",
    question: "لمن تدين، وكم، ومنذ متى",
    chord: "s",
    needs: "amounts:view",
    owns: ["/purchases", "/analysis"],
    children: [
      { href: "/suppliers", label: "الحسابات", needs: "supplier:view" },
      { href: "/purchases/invoices", label: "الفواتير" },
      { href: "/statements", label: "الكشوف", needs: "supplier:view" },
      { href: "/analysis", label: "الأصناف والأسعار" },
    ],
  },
  {
    href: "/payments",
    label: "الدفعات",
    short: "الدفعات",
    icon: "payments",
    group: "money",
    question: "ماذا تدفع، ومتى، وهل يكفي النقد",
    chord: "p",
    needs: "amounts:view",
    owns: [],
    children: [
      { href: "/payments", label: "دفعة الشهر", needs: "payment:approve" },
      { href: "/cash", label: "النقد القادم", needs: "bank:view" },
    ],
  },
  {
    href: "/bank",
    label: "البنك",
    short: "البنك",
    icon: "bank",
    group: "money",
    question: "ما دخل وما خرج، وأين ذهب المال",
    chord: "b",
    needs: "bank:view",
    owns: ["/money/expenses", "/money/statement"],
    children: [
      { href: "/bank", label: "حركة البنك" },
      { href: "/money", label: "أين ذهب" },
    ],
  },
  {
    href: "/close",
    label: "إقفال الشهر",
    short: "الإقفال",
    icon: "close",
    group: "money",
    question: "هل يستقيم الشهر، وما يمنع إقفاله",
    chord: "c",
    needs: "month:close",
    owns: [],
    children: [],
  },
  {
    href: "/inventory",
    label: "الجرد",
    short: "الجرد",
    icon: "inventory",
    group: "ops",
    question: "أين ذهب ما اشتريتَه",
    chord: "i",
    needs: "inventory:view",
    owns: ["/inventory/counts", "/inventory/trend", "/inventory/mapping"],
    children: [
      { href: "/inventory", label: "الجرد الحالي" },
      /* أسبوعيٌّ كالجرد نفسِه: ملفُّ المبيعات، والكتالوجُ مرّةً ثمّ عند تغيّره */
      { href: "/inventory/import", label: "الاستيراد", needs: "inventory:count" },
      /* السجلُّ جوابُه بالريال — فمن لا يرى المبالغ لا يُفتَح له */
      { href: "/inventory/history", label: "سجلّ الجرد", needs: "amounts:view" },
      { href: "/inventory/recipes", label: "الوصفات", needs: "recipe:edit" },
      { href: "/inventory/items", label: "الأصناف" },
    ],
  },
];

/**
 * ما يُضبط مرّةً في العمر لا يأخذ موضعاً بين الأعمال اليوميّة — أسفلَ الشريط.
 */
export const ACCOUNT_LINKS: readonly (NavLink & { icon: NavIcon })[] = [
  { href: "/settings", label: "الإعدادات", needs: "supplier:view", icon: "settings" },
  { href: "/settings/audit", label: "سجلّ التدقيق", needs: "audit:view", icon: "audit" },
];

/** شريطُ الجوّال: ثلاثُ مساحاتٍ وزرُّ الالتقاط في الوسط و«المزيد». */
export const MOBILE_TABS = 3;

function allowed(role: Role, link: NavLink): boolean {
  return !link.needs || can(role, link.needs);
}

export function visibleAreas(role: Role): NavArea[] {
  /* مساحةٌ ألسنتُها كلُّها خارج الصلاحية لا تُعرض — مدخلٌ يُفتح على «لا صلاحية» زرٌّ لا يعمل */
  return AREAS.filter(
    (a) => allowed(role, a) && (a.children.length === 0 || visibleChildrenAll(role, a).length > 0),
  );
}

function visibleChildrenAll(role: Role, area: NavArea): NavLink[] {
  return area.children.filter((c) => allowed(role, c));
}

/** ألسنةُ المساحة الظاهرة للدور — ولسانٌ واحد ليس تفريعاً. */
export function visibleChildren(role: Role, area: NavArea): NavLink[] {
  const kids = visibleChildrenAll(role, area);
  return kids.length > 1 ? kids : [];
}

/**
 * مدخلُ المساحة لهذا الدور: أوّلُ لسانٍ يملكه.
 * المحاسبُ لا يعتمد الدفعات، فمدخلُه إلى «الدفعات» النقدُ القادم لا صفحةٌ تردّه.
 */
export function entryHref(role: Role, area: NavArea): string {
  if (area.children.length === 0) return area.href;
  return visibleChildrenAll(role, area)[0]?.href ?? area.href;
}

export function visibleAccountLinks(role: Role): (NavLink & { icon: NavIcon })[] {
  return ACCOUNT_LINKS.filter((l) => allowed(role, l));
}

/** المساحاتُ مجموعةً بترتيبها — للشريط الجانبيّ. */
export function groupedAreas(role: Role): { group: NavGroup; label: string | null; areas: NavArea[] }[] {
  const visible = visibleAreas(role);
  return (["today", "money", "ops"] as const)
    .map((group) => ({ group, label: GROUP_LABEL[group], areas: visible.filter((a) => a.group === group) }))
    .filter((g) => g.areas.length > 0);
}

/**
 * المساحة التي ينتمي إليها المسار — أطول بادئة، و`/` لا تُطابَق بالبادئة
 * وإلّا ابتلعت كلّ مسار.
 */
export function activeArea(pathname: string): NavArea | undefined {
  const path = normalize(pathname);
  if (path === "/") return AREAS[0];

  let best: NavArea | undefined;
  let bestLength = 0;

  for (const area of AREAS) {
    for (const base of [area.href, ...area.owns, ...area.children.map((c) => c.href)]) {
      if (base === "/") continue;
      if (path === base || path.startsWith(`${base}/`)) {
        if (base.length > bestLength) {
          best = area;
          bestLength = base.length;
        }
      }
    }
  }
  return best;
}

/** اللسان الظاهر داخل المساحة — أطول بادئة أيضاً. */
export function activeChild(pathname: string, area: NavArea): NavLink | undefined {
  const path = normalize(pathname);
  let best: NavLink | undefined;
  let bestLength = -1;

  for (const child of area.children) {
    if (path === child.href || path.startsWith(`${child.href}/`)) {
      if (child.href.length > bestLength) {
        best = child;
        bestLength = child.href.length;
      }
    }
  }
  return best;
}

/**
 * شريطُ الجوّال: ثلاثُ مساحاتٍ ثمّ «المزيد».
 * والمساحة المفتوحة تُرفع إلى الشريط وإن كانت في «المزيد»، كي لا يفقد
 * المستخدم موضعه.
 */
export function mobileTabs(
  role: Role,
  pathname: string,
): { tabs: NavArea[]; more: NavArea[] } {
  const visible = visibleAreas(role);
  const tabs = visible.slice(0, MOBILE_TABS);
  const more = visible.slice(MOBILE_TABS);

  const active = activeArea(pathname);
  if (active && more.some((a) => a.href === active.href)) {
    const swapped = [...tabs.slice(0, MOBILE_TABS - 1), active];
    return {
      tabs: swapped,
      more: visible.filter((a) => !swapped.some((t) => t.href === a.href)),
    };
  }
  return { tabs, more };
}

/** اختصاراتُ `g` للدور — الحرفُ والوجهة. */
export function chordsFor(role: Role): { chord: string; href: string; label: string }[] {
  return visibleAreas(role).map((a) => ({ chord: a.chord, href: entryHref(role, a), label: a.label }));
}

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}
