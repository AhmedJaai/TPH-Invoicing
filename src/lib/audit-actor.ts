/**
 * «مَن فعل هذا؟» — قاعدةٌ واحدة لكلّ شاشةٍ تعرض فاعلَ قيدٍ في سجلّ التدقيق.
 *
 * العملُ الآليّ يُكتب بمعرّف المالك (مفتاحٌ أجنبيّ إلى `users`): التشغيلُ المجدول،
 * والاستدراكُ الخلفيّ من القشرة يجري بجلسة من فتح الصفحة. فكان كلُّ تنبيهٍ يقول
 * «بواسطة Ahmed» لما لم تمسّه يدُه. والقيدُ الآليّ يُوسَم عند كتابته
 * (`"المنفّذ": "system:…"` — `lib/actor-context.ts`)، وما سبق الوسمَ يُعرَف بعلاماته
 * الصريحة وحدها: لا يُنسَب إلى النظام ما قد يكون إنسانٌ ضغطه.
 */

export const SYSTEM_ACTOR_NAME = "النظام";

export interface AuditActorRow {
  actorId: string | null;
  after: unknown;
}

/** مصادرُ إعادة التسمية الآليّة كما كتبها `drive-rename.service.ts` قبل الوسم. */
const AUTOMATIC_SOURCES = new Set(["المزامنة", "الاستدراك"]);
/** أسبابٌ لا يكتبها إلّا عملٌ آليّ — أو نصُّ إصلاحٍ نفّذه Claude بإذن. */
const AUTOMATIC_REASON = /آلي|الأرشفة الآليّة|القراءة المحفوظة|نفّذه Claude/;

function field(after: unknown, key: string): unknown {
  if (typeof after !== "object" || after === null || Array.isArray(after)) return undefined;
  return Object.hasOwn(after, key) ? Reflect.get(after, key) : undefined;
}

export function isSystemAudit(row: AuditActorRow): boolean {
  if (row.actorId === null) return true;
  const executor = field(row.after, "المنفّذ");
  if (typeof executor === "string" && executor.startsWith("system:")) return true;
  if (field(row.after, "auto") === true) return true;
  const source = field(row.after, "المصدر");
  if (typeof source === "string" && (AUTOMATIC_SOURCES.has(source) || AUTOMATIC_REASON.test(source))) return true;
  return ["السبب", "نوع"].some((k) => {
    const reason = field(row.after, k);
    return typeof reason === "string" && AUTOMATIC_REASON.test(reason);
  });
}

/** اسمُ الفاعل للعرض: «النظام» لما فعله النظام، و«أنت» لصاحب الشاشة، وإلّا اسمُه. */
export function auditActorName(
  row: AuditActorRow & { actorName: string | null },
  viewerId?: string,
): string {
  if (isSystemAudit(row)) return SYSTEM_ACTOR_NAME;
  if (viewerId !== undefined && row.actorId === viewerId) return "أنت";
  return row.actorName ?? "مستخدم آخر";
}
