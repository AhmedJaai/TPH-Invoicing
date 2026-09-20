/**
 * نموذج التنقّل: خمسُ مساحات، وألسنةٌ داخلها.
 *
 * كانت ستَّ مساحاتٍ وسبعةَ عشر رابطاً في شريطٍ علويٍّ من صفّين — أي
 * «عشرون رابطاً قبل المحتوى» بنصّ التعليق الذي كان في `page-shell.tsx`.
 * وكان فيها ما ليس وجهةً أصلاً: «الإعدادات» تُضبط مرّةً في العمر
 * وتحتلّ سُدس شريط التنقّل، و«الرفع» فعلٌ لا مكان.
 *
 * فصارت المساحة سؤالاً يفتحه صاحب المقهى:
 *
 *   الرئيسية    — ما حال المقهى اليوم؟
 *   يحتاج قرارك — ما الذي ينتظرني؟
 *   المورّدون   — لمن أدين، وكم، ومتى أدفع؟
 *   المال       — أين ذهب المال، وهل يستقيم الشهر؟
 *   المستندات   — ما الذي وصلني؟
 *
 * والمساحةُ تجمع ما يُسأل معاً لا ما يُخزَّن معاً: «دفعة الشهر» عند
 * المورّدين لأنّها جوابُ «لمن أدين»، و«الأصناف والأسعار» و«المصروفات»
 * خرجتا من الألسنة إلى مداخلَ في موضعهما — وبقي مساراهما عاملين.
 *
 * والإعدادات في قائمة المستخدم، والرفع زرٌّ دائم فوق المساحات.
 *
 * ولمّا كانت هذه الروابط تُبنى على الخادم وتُعرض على الجوّال وتُختبر،
 * فُصلت عن مكوّن العرض: البنية هنا، والرسم في `components/nav.tsx`.
 */
import { can, type Capability, type Role } from "./permissions";

export interface NavLink {
  href: string;
  label: string;
  needs?: Capability;
}

export interface NavArea extends NavLink {
  /** الاسم القصير لشريط الجوّال — «المال» لا «المال والالتزامات». */
  short: string;
  /** المسارات التي تنتمي إلى هذه المساحة وإن لم تظهر في القائمة. */
  owns: readonly string[];
  /** ألسنةُ المساحة — لا مساحاتٌ فرعيّة. */
  children: readonly NavLink[];
}

/**
 * الخمس. والترتيب مقصود: يبدأ بما يُفتح كلّ صباح.
 *
 * واسم اللسان هو عنوان الصفحة التي يفتحها — حرفاً بحرف. وكان «كشف
 * الحساب» يفتح «التدفّق النقدي وقائمة الدخل»، والعبارة في البنوك
 * السعوديّة تعني كشف البنك: فيضغطها صاحب العمل يطلب حركاته فيجد قائمة
 * دخل. وهذا نصّ شكواه: «تودّي على أماكن غلط».
 */
export const AREAS: readonly NavArea[] = [
  {
    href: "/",
    label: "الرئيسية",
    short: "الرئيسية",
    owns: [],
    children: [],
  },
  {
    href: "/attention",
    label: "يحتاج قرارك",
    short: "قرارك",
    needs: "reports:view",
    /*
      `/review` كان مساحةَ عملٍ ثانية وهو فارغٌ بحكم تعريفه، فابتُلع هنا:
      ورشةُ قرار البنك صارت لوحَ تفصيلٍ داخل هذه المساحة.
    */
    owns: ["/review", "/audit"],
    children: [],
  },
  {
    href: "/suppliers",
    label: "المورّدون",
    short: "المورّدون",
    needs: "amounts:view",
    owns: ["/purchases", "/analysis"],
    /*
      كانت «المشتريات» و«المورّدون» مساحتين لشيءٍ واحد: الفاتورة تأتي من
      مورّد، والكشف كشفُ مورّد، والصنف صنفُه. وكانت `/purchases` سبعَ
      بطاقاتٍ كلُّها روابط — فهرسٌ في ثوب صفحة — و`/purchases/insights`
      تعدّ ١٢ مورّداً بينما `/suppliers` تعدّ ٢٢.

      ── ولماذا «دفعة الشهر» هنا ──

      كانت لساناً في «المال». فصاحب المقهى يقرأ «عليك ١٠٬٥٠٢٫٤٩ لستّة
      مورّدين» في مساحة، ثمّ **يبدّل المساحة كلَّها** ليدفع لهم — والسؤال
      واحد: «لمن أدين، وكم أحوّل أوّل الشهر؟». وكان موضعُها في «المال»
      لأنّ ناتجها ملفُّ تحويلات، وذلك سببٌ من بناء النظام لا من عمل
      صاحبه.

      و«الأصناف والأسعار» خرجت من الألسنة إلى `owns`: سؤالٌ يُسأل مرّاتٍ
      في السنة لا يأخذ خُمس شريطٍ يُقرأ كلَّ يوم. ومدخلُها من «الحسابات»
      ومن ملفّ كلّ مورّد، ومسارها كما هو.
    */
    children: [
      { href: "/suppliers", label: "الحسابات", needs: "supplier:view" },
      { href: "/purchases/invoices", label: "الفواتير" },
      { href: "/statements", label: "الكشوف", needs: "supplier:view" },
      { href: "/payments", label: "دفعة الشهر", needs: "payment:approve" },
    ],
  },
  {
    href: "/money",
    label: "المال",
    short: "المال",
    needs: "bank:view",
    /*
      و«المصروفات» خرجت من الألسنة كذلك — لا لأنّ الصفحات كثيرة، بل
      لأنّ جوابها على البيانات الحقيقيّة اليوم «لا يمكن الحساب»:
      المتوقَّع صفرٌ ما لم تُسجَّل مصروفاتٌ متكرّرة. فمدخلُها من «أين
      ذهب» حيث يُقرأ المصروفُ فعلاً.
    */
    owns: ["/bank", "/close", "/money/expenses"],
    children: [
      { href: "/money", label: "أين ذهب" },
      { href: "/bank", label: "حركة البنك" },
      { href: "/close", label: "إقفال الشهر", needs: "month:close" },
    ],
  },
  {
    href: "/documents",
    label: "المستندات",
    short: "المستندات",
    owns: ["/upload"],
    children: [],
  },
];

/**
 * ما يُضبط مرّةً في العمر لا يُعطى سُدسَ شريط التنقّل.
 *
 * وفيه ما لا يخصّ صاحب المقهى أصلاً: رقمُ الهجرات واسمُ النموذج القارئ.
 * فمكانُه قائمةُ المستخدم.
 */
export const ACCOUNT_LINKS: readonly NavLink[] = [
  { href: "/settings", label: "الإعدادات", needs: "supplier:view" },
  { href: "/settings/audit", label: "سجلّ التدقيق", needs: "audit:view" },
];

/** عدد المساحات الظاهرة في شريط الجوّال السفليّ قبل «المزيد». */
export const MOBILE_TABS = 4;

function allowed(role: Role, link: NavLink): boolean {
  return !link.needs || can(role, link.needs);
}

export function visibleAreas(role: Role): NavArea[] {
  return AREAS.filter((a) => allowed(role, a));
}

export function visibleChildren(role: Role, area: NavArea): NavLink[] {
  const kids = area.children.filter((c) => allowed(role, c));
  // لسانٌ واحد ليس تفريعاً — فلا يُعرض شريط ألسنةٍ لمساحة بلا اختيار.
  return kids.length > 1 ? kids : [];
}

export function visibleAccountLinks(role: Role): NavLink[] {
  return ACCOUNT_LINKS.filter((l) => allowed(role, l));
}

/**
 * المساحة التي ينتمي إليها المسار.
 *
 * تُطابَق أطول بادئة، كي يذهب `/purchases/invoices` إلى «المورّدون» لا
 * إلى الرئيسية. و`/` وحدها لا تُطابَق بالبادئة وإلّا ابتلعت كل مسار.
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
 * شريط الجوّال: أربع مساحات ثمّ «المزيد».
 *
 * والمساحة المفتوحة تُرفع إلى الشريط وإن كانت في «المزيد»، كي لا يفقد
 * المستخدم موضعه من التطبيق لأنّه فتح صفحةً بعيدة.
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

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}
