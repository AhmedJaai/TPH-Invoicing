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
  | "users:manage"
  | "audit:view";

const MATRIX: Record<Role, readonly Capability[]> = {
  OWNER: [
    "document:upload", "document:view", "supplier:view", "supplier:edit",
    "amounts:view", "reports:view", "bank:view", "bank:edit", "payroll:view",
    "expense:edit", "payment:approve", "month:close", "users:manage", "audit:view",
  ],
  // المحاسب يرى كل المالية ولا يدير المستخدمين
  ACCOUNTANT: [
    "document:upload", "document:view", "supplier:view", "supplier:edit",
    "amounts:view", "reports:view", "bank:view", "bank:edit",
    "expense:edit", "month:close", "audit:view",
  ],
  // مدير المشتريات يرفع ويتابع الناقص فقط — لا أرقام مالية ولا بنك ولا رواتب
  PURCHASING: ["document:upload", "document:view", "supplier:view"],
};

export function can(role: Role | undefined | null, capability: Capability): boolean {
  if (!role) return false;
  return MATRIX[role]?.includes(capability) ?? false;
}

export function capabilitiesOf(role: Role): readonly Capability[] {
  return MATRIX[role];
}

/** يُرمى داخل الواجهات البرمجية ليُترجم إلى 403. */
export class ForbiddenError extends Error {
  readonly capability: Capability;
  constructor(capability: Capability) {
    super(`لا تملك صلاحية: ${capability}`);
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
