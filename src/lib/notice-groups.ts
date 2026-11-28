import type { Notice } from "@/services/notifications.service";

/**
 * قسمةُ الجرس: ما يحتاج فعلاً (تحذيرٌ أو خطر) وما جرى (علمٌ فقط). كلُّ قسمٍ بالأحدث أوّلاً،
 * إلّا أنّ الخطرَ قبل التحذير في الأوّل — المتأخّرُ قبل ما حلّ اليوم.
 */
export function splitNotices(notices: readonly Notice[]): { act: Notice[]; happened: Notice[] } {
  const act = notices.filter((n) => n.tone === "danger" || n.tone === "warn")
    .sort((a, b) => (a.tone === b.tone ? b.at.localeCompare(a.at) : a.tone === "danger" ? -1 : 1));
  const happened = notices.filter((n) => n.tone !== "danger" && n.tone !== "warn").sort((a, b) => b.at.localeCompare(a.at));
  return { act, happened };
}
