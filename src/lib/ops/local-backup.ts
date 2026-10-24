/**
 * النسخة اليوميّة على جهاز المالك — قواعدها النقيّة.
 * النصّ الذي يشغّلها: `scripts/backup-local.ts`.
 *
 * ثلاثة أشياء تتغيّر كلّ يوم وتُنسخ كاملةً في مجلّد اليوم: القاعدة والشيفرة
 * والأسرار. والدرايف كبيرٌ وقلّما يتغيّر، فمرآةٌ واحدة تُزاد ولا يُحذف منها:
 * ما حُذف من الدرايف يبقى في المرآة، وما تغيّر محتواه تُحفظ نسختُه القديمة.
 */

/** أيّامٌ متتالية تبقى كاملة. */
export const KEEP_DAILY = 14;
/** وبعدها أوّلُ نسخةٍ من كلّ شهرٍ لهذا العدد من الأشهر. */
export const KEEP_MONTHLY = 24;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * أيُّ مجلّدات الأيّام تُحذف. لا يُحذف إلّا ما اسمُه تاريخ — مجلّدٌ وضعه
 * إنسانٌ بيده لا يمسّه الكنس — ولا تُحذف أحدثُ نسخةٍ مهما كان.
 */
export function daysToPrune(names: readonly string[], keepDaily = KEEP_DAILY, keepMonthly = KEEP_MONTHLY): string[] {
  const days = names.filter((n) => DAY.test(n)).sort().reverse();
  const keep = new Set(days.slice(0, Math.max(1, keepDaily)));
  const firstOfMonth = new Map<string, string>();
  for (const d of days) firstOfMonth.set(d.slice(0, 7), d); // الترتيب تنازليّ، فالأخير أقدمُ يومٍ في شهره
  for (const d of [...firstOfMonth.values()].sort().reverse().slice(0, keepMonthly)) keep.add(d);
  return days.filter((d) => !keep.has(d)).sort();
}

/** اسمُ ملفٍّ أو مجلّدٍ من الدرايف صالحٌ على القرص: لا `/` ولا ما يُسقط المسار. */
export function safeSegment(name: string): string {
  const s = name.replace(/[/\\\0]/g, "∕").replace(/[\u0000-\u001f]/g, " ").trim();
  if (s === "" || s === "." || s === "..") return "_";
  return s.length > 200 ? s.slice(0, 200) : s;
}

/** ملفّان بالاسم نفسه في مجلّدٍ واحد: الثاني يحمل بداية معرّفه. */
export function disambiguate(name: string, id: string): string {
  const dot = name.lastIndexOf(".");
  const tag = ` [${id.slice(0, 8)}]`;
  return dot > 0 ? name.slice(0, dot) + tag + name.slice(dot) : name + tag;
}

/** مستندات جوجل لا محتوى لها يُنزَّل — تُصدَّر. وما لا تصدير له يُذكر في التقرير. */
export const GOOGLE_EXPORTS: Readonly<Record<string, { mime: string; ext: string }>> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx",
  },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: ".pdf" },
};

/** بصمةُ النسخة في المرآة: md5 الدرايف، وإلّا وقتُ التعديل (لمستندات جوجل). */
export function mirrorVersion(f: { md5Checksum?: string; modifiedTime?: string }): string | null {
  return f.md5Checksum ?? (f.modifiedTime ? `t:${f.modifiedTime}` : null);
}

/** يُنزَّل الملفّ إن لم يكن في المرآة، أو تغيّرت بصمتُه، أو غاب ملفُّه من القرص. */
export function needsDownload(
  prev: { version: string | null; path: string } | undefined,
  version: string | null,
  path: string,
  existsOnDisk: (p: string) => boolean,
): boolean {
  if (!prev) return true;
  if (!existsOnDisk(prev.path)) return true;
  if (version === null) return prev.path !== path; // بلا بصمة: لا نعيد التنزيل كلّ يوم
  return prev.version !== version;
}
