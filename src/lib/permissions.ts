/**
 * الصلاحيات.
 *
 * تُفرض على الخادم دائماً. إخفاء عنصر في الواجهة ليس صلاحية —
 * مدير المشتريات الذي يستدعي واجهة الأرقام مباشرةً يجب أن يُرفض بـ403.
 */

export type Role = "OWNER" | "ACCOUNTANT" | "PURCHASING";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "المالك",
  ACCOUNTANT: "المحاسب",
  PURCHASING: "مدير المشتريات",
};

/** كل قدرة في النظام، مفصولة عن الأدوار حتى تُراجَع الجداول لا الشروط المتناثرة. */
export type Capability =
  | "document:upload"
  | "document:view"
  | "supplier:view"
  | "supplier:edit"
  | "amounts:view"
  | "reports:view"
  | "bank:view"
  | "bank:edit"
  | "expense:edit"
  | "payroll:view"
  | "payment:approve"
  | "month:close"
  | "month:reopen"
  | "users:manage"
  | "audit:view"
  /*
    الجرد: القراءةُ غير الكتابة، والوصفةُ غير العدّ.

    ومديرُ المشتريات يعدّ الرفّ ولا يرى كلفةَ الفرق — فهو يقف عند
    الميزان لا عند الدفتر. و«الأرقام المالية» تبقى محروسةً
    بـ`amounts:view` كما هي.
  */
  | "inventory:view"
  | "inventory:count"
  /**
   * إعادةُ فتح جردٍ مقفَل — فعلٌ مستقلّ لا يُعار من إقفال الشهر.
   *
   * إقفالُ الشهر المحاسبيّ وإقفالُ الجرد فعلان على بياناتٍ مختلفة،
   * ومن ملك أحدَهما لا يلزم أن يملك الآخر. والصلاحيّةُ المشتركة
   * تُوسّع الأذن بلا قصد.
   */
  | "inventory:reopen"
  | "recipe:edit";

const MATRIX: Record<Role, readonly Capability[]> = {
  OWNER: [
    "document:upload", "document:view", "supplier:view", "supplier:edit",
    "amounts:view", "reports:view", "bank:view", "bank:edit", "payroll:view",
    "expense:edit", "payment:approve", "month:close", "month:reopen", "users:manage", "audit:view",
    "inventory:view", "inventory:count", "inventory:reopen", "recipe:edit",
  ],
  // المحاسب يرى كل المالية ولا يدير المستخدمين
  ACCOUNTANT: [
    "document:upload", "document:view", "supplier:view", "supplier:edit",
    "amounts:view", "reports:view", "bank:view", "bank:edit",
    "expense:edit", "month:close", "audit:view",
    "inventory:view", "inventory:count", "recipe:edit",
  ],
  // مدير المشتريات يرفع ويتابع الناقص فقط — لا أرقام مالية ولا بنك ولا رواتب
  PURCHASING: ["document:upload", "document:view", "supplier:view", "inventory:view", "inventory:count"],
};

export function can(role: Role | undefined | null, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(capability) ?? false;
}

export function capabilitiesOf(role: Role): readonly Capability[] {
  return MATRIX[role];
}

/** اسمُ القدرة لقارئ الرسالة — لا «payment:approve» لمن يُحجَب. */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  "document:upload": "رفع المستندات",
  "document:view": "عرض المستندات",
  "supplier:view": "عرض المورّدين",
  "supplier:edit": "تعديل المورّدين والأصناف",
  "amounts:view": "رؤية المبالغ",
  "reports:view": "عرض التقارير",
  "bank:view": "عرض كشف البنك",
  "bank:edit": "تصنيف حركات البنك",
  "expense:edit": "تعديل المصروفات",
  "payroll:view": "عرض الرواتب",
  "payment:approve": "اعتماد السداد",
  "month:close": "إقفال الشهر",
  "month:reopen": "إعادة فتح الشهر",
  "users:manage": "إدارة المستخدمين",
  "audit:view": "عرض سجلّ التدقيق",
  "inventory:view": "عرض الجرد",
  "inventory:count": "إدخال الجرد وإقفاله",
  "inventory:reopen": "إعادة فتح جردٍ مقفَل",
  "recipe:edit": "تعديل الوصفات",
};

/** يُرمى داخل الواجهات البرمجية ليُترجم إلى 403. */
export class ForbiddenError extends Error {
  readonly capability: Capability;
  constructor(capability: Capability) {
    super(`هذا الفعل يحتاج صلاحية «${CAPABILITY_LABEL[capability]}» — اطلبها من مالك الحساب.`);
    this.name = "ForbiddenError";
    this.capability = capability;
  }
}

export function require_(role: Role | undefined | null, capability: Capability): void {
  if (!can(role, capability)) throw new ForbiddenError(capability);
}

/**
 * قائمة الدخول البيضاء وأدوارها، من متغيّر البيئة.
 * الصيغة: "ahmed@x.com:OWNER,acc@x.com:ACCOUNTANT,buy@x.com:PURCHASING"
 */
export function parseAllowlist(raw: string | undefined): Map<string, Role> {
  const map = new Map<string, Role>();
  if (!raw) return map;
  for (const entry of raw.split(",")) {
    const [email, role] = entry.split(":").map((s) => s?.trim());
    if (!email) continue;
    const normalized = email.toLowerCase();
    const resolved: Role =
      role === "OWNER" || role === "ACCOUNTANT" || role === "PURCHASING" ? role : "PURCHASING";
    map.set(normalized, resolved);
  }
  return map;
}

export function allowlist(): Map<string, Role> {
  return parseAllowlist(process.env.ALLOWED_EMAILS);
}
