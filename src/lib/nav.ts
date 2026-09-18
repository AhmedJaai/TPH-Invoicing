/**
 * نموذج التنقّل: المساحات وأقسامها.
 *
 * الصفحة ليست وجهةً بذاتها، بل قسمٌ داخل مساحة يفتحها صاحب المقهى لسؤال
 * في رأسه. فـ«كشوف المورّدين» ليست بنداً في قائمة، بل طريقة مراجعة حساب
 * مورّد — ومكانها تحت «المشتريات».
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
  children: readonly NavLink[];
}

/**
 * المساحات الستّ. الترتيب مقصود: يبدأ بما يُفتح كل صباح، وينتهي بما
 * يُفتح مرّة في العمر.
 *
 * واسم القسم هو عنوان الصفحة التي يفتحها — حرفاً بحرف. وكان «كشف
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
    label: "يحتاج انتباهك",
    short: "انتباهك",
    needs: "reports:view",
    owns: ["/audit"],
    children: [],
  },
  {
    href: "/purchases",
    label: "المشتريات",
    short: "المشتريات",
    needs: "amounts:view",
    owns: ["/suppliers", "/statements", "/analysis", "/performance"],
    /*
      «كم أدين ولمن؟» سؤال أحمد الأوّل، فهو أوّل الأقسام وباسمه لا باسم
      الأداة التي تحسبه. وكان تحت «تحليل الذكاء»، وبجانبه «المستحقّ عليك»
      يفتح قائمة فواتير لا يُخصم منها ما دُفع ولم يُخصَّص — فيظنّ من فتحه
      أنّه مدين لمورّدٍ دفع له مقدَّماً. والمرشِّح `?paid=OPEN` بقي داخل
      صفحة الفواتير، ولا يُرفع إلى التنقّل: القسم وجهةٌ لا ترشيح.
    */
    children: [
      { href: "/purchases/insights", label: "عليك لكلّ مورّد" },
      { href: "/purchases", label: "النظرة العامة" },
      { href: "/purchases/invoices", label: "الفواتير" },
      { href: "/suppliers", label: "المورّدون", needs: "supplier:view" },
      { href: "/purchases/products", label: "الأصناف" },
      { href: "/performance", label: "الأسعار" },
      { href: "/analysis", label: "الإنفاق على الأصناف", needs: "reports:view" },
      { href: "/statements", label: "كشوف المورّدين", needs: "supplier:view" },
    ],
  },
  {
    href: "/money",
    label: "المال",
    short: "المال",
    needs: "bank:view",
    owns: ["/bank", "/review", "/payments", "/close"],
    children: [
      { href: "/money", label: "النظرة العامة" },
      { href: "/payments", label: "دفعة الشهر", needs: "payment:approve" },
      { href: "/money/expenses", label: "المصروفات" },
      { href: "/bank", label: "البنك" },
      { href: "/review", label: "طابور المراجعة", needs: "bank:view" },
      { href: "/money/statement", label: "التدفّق وقائمة الدخل" },
      { href: "/close", label: "إقفال الشهر", needs: "month:close" },
    ],
  },
  {
    href: "/documents",
    label: "المستندات",
    short: "المستندات",
    owns: ["/upload"],
    children: [
      { href: "/documents", label: "المستندات" },
      { href: "/upload", label: "ارفع مستنداً", needs: "document:upload" },
    ],
  },
  {
    href: "/settings",
    label: "الإعدادات",
    short: "الإعدادات",
    needs: "supplier:view",
    owns: [],
    children: [
      { href: "/settings", label: "عام" },
      { href: "/settings/audit", label: "سجلّ التدقيق", needs: "audit:view" },
    ],
  },
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
  // قسمٌ واحد ليس تفريعاً — فلا يُعرض شريط أقسام لمساحة بلا اختيار.
  return kids.length > 1 ? kids : [];
}

/**
 * المساحة التي ينتمي إليها المسار.
 *
 * تُطابَق أطول بادئة، كي يذهب `/purchases/products` إلى «المشتريات» لا
 * إلى الرئيسية. و`/` وحدها لا تُطابَق بالبادئة وإلّا ابتلعت كل مسار.
 */
export function activeArea(pathname: string): NavArea | undefined {
  const path = normalize(pathname);
  if (path === "/") return AREAS[0];

  let best: NavArea | undefined;
  let bestLength = 0;

  for (const area of AREAS) {
    for (const base of [area.href, ...area.owns]) {
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

/** القسم الظاهر داخل المساحة — أطول بادئة أيضاً. */
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
