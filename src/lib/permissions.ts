/**
 * الصلاحيات.
 *
 * تُفرض على الخادم دائماً. إخفاء عنصر في الواجهة ليس صلاحية —
 * مدير المشتريات الذي يستدعي واجهة الأرقام مباشرةً يجب أن يُرفض بـ403.
 */

/**
 * «المراجع» (AUDITOR) يرى ولا يغيّر: المحاسبُ القانونيّ الخارجيّ أو الشريك في موسم
 * الإقرار. لا قدرةَ كتابةٍ له واحدة — يحرسه `permissions.writes.test.ts`.
 */
export type Role = "OWNER" | "ACCOUNTANT" | "PURCHASING" | "AUDITOR";

export const ROLES: readonly Role[] = ["OWNER", "ACCOUNTANT", "PURCHASING", "AUDITOR"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && ROLES.some((r) => r === v);
}

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "المالك",
  ACCOUNTANT: "المحاسب",
  PURCHASING: "مدير المشتريات",
  AUDITOR: "المراجع (قراءة فقط)",
};

/** كل قدرة في النظام، مفصولة عن الأدوار حتى تُراجَع الجداول لا الشروط المتناثرة. */
export type Capability =
  | "document:upload"
  | "document:view"
  | "supplier:view"
  | "supplier:edit"
  | "amounts:view"
  /**
   * تصحيحُ مبالغ الفاتورة ومورّدها — كتابةٌ لا تُعار من «رؤية المبالغ».
   * اليومَ يملكها كلُّ من يرى؛ وأوّلُ دورٍ «قراءة فقط» لا يرث الكتابةَ بالاسم.
   */
  | "invoice:edit"
  | "reports:view"
  /** تنزيلُ حزمة المحاسب وملفّ الإقرار — قراءةٌ لا تُعار من «إقفال الشهر». */
  | "reports:export"
  | "bank:view"
  | "bank:edit"
  | "expense:edit"
  /**
   * ⚠ معرَّفةٌ ولا تُفرَض بعد: لا صفحةَ ولا مسارَ يسأل عنها، فمن يملك `bank:view` يرى
   * حوالات الرواتب في كشف البنك والمصروفات. فلا تُعدّ حمايةً قائمة — انظر `SECURITY.md` §٥.
   */
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
    "amounts:view", "invoice:edit", "reports:view", "reports:export", "bank:view", "bank:edit", "payroll:view",
    "expense:edit", "payment:approve", "month:close", "month:reopen", "users:manage", "audit:view",
    "inventory:view", "inventory:count", "inventory:reopen", "recipe:edit",
  ],
  // المحاسب يرى كل المالية ولا يدير المستخدمين
  ACCOUNTANT: [
    "document:upload", "document:view", "supplier:view", "supplier:edit",
    "amounts:view", "invoice:edit", "reports:view", "reports:export", "bank:view", "bank:edit",
    "expense:edit", "month:close", "audit:view",
    "inventory:view", "inventory:count", "recipe:edit",
  ],
  // مدير المشتريات يرفع ويتابع الناقص فقط — لا أرقام مالية ولا بنك ولا رواتب
  PURCHASING: ["document:upload", "document:view", "supplier:view", "inventory:view", "inventory:count"],
  // المراجع يقرأ المالية كلَّها وينزّل حزمة المحاسب — ولا يكتب شيئاً، ولا يرى الرواتب
  AUDITOR: [
    "document:view", "supplier:view", "amounts:view", "reports:view", "reports:export",
    "bank:view", "audit:view", "inventory:view",
  ],
};

/**
 * قدراتُ القراءة — وما عداها كتابة. «المراجع» لا يملك إلّا منها.
 * (`reports:export` تنزيلٌ يُقيَّد في السجلّ ولا يغيّر بياناً.)
 */
export const READ_CAPABILITIES: readonly Capability[] = [
  "document:view", "supplier:view", "amounts:view", "reports:view", "reports:export",
  "bank:view", "payroll:view", "audit:view", "inventory:view",
];

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
  "invoice:edit": "تصحيح مبالغ الفاتورة ومورّدها",
  "reports:view": "عرض التقارير",
  "reports:export": "تنزيل ملفّات المحاسب والإقرار",
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
 * الصيغة: "ahmed@x.com:OWNER,acc@x.com:ACCOUNTANT,buy@x.com:PURCHASING,cpa@x.com:AUDITOR"
 */
export function parseAllowlist(raw: string | undefined): Map<string, Role> {
  const map = new Map<string, Role>();
  if (!raw) return map;
  for (const entry of raw.split(",")) {
    const [email, role] = entry.split(":").map((s) => s?.trim());
    if (!email) continue;
    const normalized = email.toLowerCase();
    const resolved: Role = isRole(role) ? role : "PURCHASING";
    map.set(normalized, resolved);
  }
  return map;
}

export function allowlist(): Map<string, Role> {
  return parseAllowlist(process.env.ALLOWED_EMAILS);
}
