/**
 * فعلٌ في سجلّ التدقيق كما يُشعَر به — دالّةٌ خالصة.
 *
 * كان جرسُ الإشعارات يقول للمالك «إقفال شهر · بواسطة Ahmed» و«تعريف جهة · بواسطة Ahmed»:
 * ما فعله هو بيده قبل دقائق، سبعةٌ وعشرون «جديداً» أكثرُها منه، وكلُّها تفتح السجلَّ العامّ.
 * فصار: **فعلُ القارئ نفسِه لا يُشعَر به** (وفعلُ النظام باسمه يُشعَر به — لم يفعله إنسان)،
 * والإشعارُ يقول على أيّ شيءٍ وقع ويفتحه.
 */
import { ENTITY_LABEL } from "./audit-labels";
import { isRecordId } from "./figure-history";
import { invoiceHref } from "./invoice-profile";
import { txHref } from "./inspector";
import { formatMonth } from "./riyadh-time";

export interface ActivityTarget { label: string | null; href: string }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** إلى أين يفتح الإشعار، وما اسمُ ما وقع عليه — السجلُّ العامّ إن لم يُعرف له موضع. */
export function activityTarget(entityType: string, entityId: string): ActivityTarget {
  const label = ENTITY_LABEL[entityType] ?? null;
  const record = isRecordId(entityId);
  if (entityType === "invoice" && record) return { label, href: invoiceHref(entityId) };
  if (entityType === "bank_transaction" && record) return { label, href: txHref(entityId) };
  if (entityType === "document" && record) return { label, href: `/documents/file/${entityId}` };
  if (entityType === "employee" && record) return { label, href: `/payroll/employee/${entityId}` };
  if ((entityType === "month_close" || entityType === "month") && MONTH_RE.test(entityId)) {
    return { label: formatMonth(entityId), href: "/close" };
  }
  if (entityType === "vat_period" && MONTH_RE.test(entityId)) return { label: `ضريبة ${formatMonth(entityId)}`, href: "/close/vat" };
  return { label, href: "/settings/audit" };
}

/** فعلُ القارئ بيده لا يُشعَر به — يعرفه. وفعلُ النظام يُشعَر به وإن حمل اسمَه (التشغيلُ المجدول باسم المالك). */
export function isOwnActivity(actorId: string | null, viewerId: string, bySystem: boolean): boolean {
  return !bySystem && actorId !== null && actorId === viewerId;
}
