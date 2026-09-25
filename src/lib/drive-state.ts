/**
 * حالُ الدرايف بكلمةٍ واحدة — تقرؤها شارةُ «المستندات» ولافتةُ صفحة الدرايف
 * معاً، فلا تقول إحداهما «يعمل» والأخرى «متوقّف».
 *
 * والترتيبُ هو الحكم: وضعُ التجربة أوّلاً (لا تفويضَ فيه عمداً)، ثمّ غيابُ
 * التفويض، ثمّ تعثّرٌ أحدثُ من آخر نجاح، ثمّ «لم يُفحص بعد» — ولا يُقال
 * «يعمل» إلّا عن فحصٍ نجح فعلاً: الجهلُ ليس سلامة.
 */
export type DriveState = "preview" | "disconnected" | "failing" | "unchecked" | "ok";

export interface DriveFacts {
  previewMode: boolean;
  /** `null`: لا يُعرف (لم يُسأل) — لا يُحكم به بشيء. */
  connected: boolean | null;
  checkedAt: Date | null;
  failedAt: Date | null;
}

export function driveState(f: DriveFacts): DriveState {
  if (f.previewMode) return "preview";
  if (f.connected === false) return "disconnected";
  if (f.failedAt && (!f.checkedAt || f.failedAt > f.checkedAt)) return "failing";
  if (!f.checkedAt) return "unchecked";
  return "ok";
}
