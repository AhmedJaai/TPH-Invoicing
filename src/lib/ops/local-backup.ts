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

/* ── التشغيل كلَّ ساعة حتّى يكتمل اليوم ──
 * الجهاز يصحو على البطّاريّة دقائقَ ثمّ ينام (DarkWake)، فتنقطع النسخة في منتصفها.
 * فالجدولة كلَّ ساعة، والنصُّ يخرج بصمتٍ إن اكتمل اليومُ قبله. */

export type PartResult = { ok: boolean; detail: string };

export interface LastRun {
  lastSuccess?: string | null;
  successDay?: string | null;
  notifiedDay?: string | null;
  /** آخرُ نسخةٍ اكتملت أجزاؤها الأساسيّة (القاعدة والشيفرة والأسرار) — والدرايف مرآةٌ على حدة. */
  lastCoreSuccess?: string | null;
  day?: string | null;
  results?: Record<string, PartResult>;
}

/**
 * الأجزاءُ التي لا نسخةَ بدونها — القاعدةُ أوّلُها. والدرايف مرآةٌ تُزاد: تعذّرُها لا يجعل نسخةَ
 * القاعدة ناقصة. كان كلُّ يومٍ «ناقصاً» ثلاثةً وعشرين يوماً لأنّ تفويضَ الدرايف أُلغي، فلم يُكنس
 * يومٌ ولم يُعرف أنّ القاعدة نُسخت كلَّ يوم.
 */
export const CORE_PARTS = ["القاعدة", "الشيفرة", "الأسرار"] as const;

/**
 * ما يُشغَّل الآن: يومٌ جديد أو `--force` فكلُّها، وإلّا ما تعذّر منها اليومَ وحده — كان اليومُ
 * الناقص يُعاد كلُّه كلَّ ساعة فتُنسخ القاعدةُ أربعَ عشرةَ مرّةً لأنّ الدرايف وحده متعذّر.
 */
export function pendingParts(last: LastRun, today: string, all: readonly string[], force: boolean): string[] {
  if (force || last.day !== today || !last.results) return [...all];
  return all.filter((n) => last.results?.[n]?.ok !== true);
}

/** أاكتملت الأجزاءُ الأساسيّة؟ */
export function coreComplete(results: Readonly<Record<string, PartResult>>): boolean {
  return CORE_PARTS.every((n) => results[n]?.ok === true);
}


/** إشعارٌ واحد في اليوم على الأكثر، ولا يُزعَج إلّا إن مضى على آخر نسخةٍ كاملة يومٌ ونصف. */
export const ALERT_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * حالُ النسخة كما يقرؤها التطبيق (`job_state` · `backup:local`) — يكتبها النصُّ في آخر كلّ تشغيل.
 * سطرٌ واحد بلا مالٍ ولا اسم: متى، وأيُّ الأجزاء تعذّر وسببُه.
 */
export interface BackupHeartbeat {
  at: string;
  day: string;
  coreOk: boolean;
  driveOk: boolean;
  lastCoreSuccess: string | null;
  lastFullSuccess: string | null;
  failed: { part: string; detail: string }[];
}

export const BACKUP_HEARTBEAT_ROW = "backup:local";

export function buildHeartbeat(now: Date, day: string, results: Readonly<Record<string, PartResult>>, last: LastRun): BackupHeartbeat {
  const coreOk = coreComplete(results);
  const driveOk = results["الدرايف"]?.ok === true;
  return {
    at: now.toISOString(),
    day,
    coreOk,
    driveOk,
    lastCoreSuccess: coreOk ? now.toISOString() : last.lastCoreSuccess ?? null,
    lastFullSuccess: coreOk && driveOk ? now.toISOString() : last.lastSuccess ?? null,
    failed: Object.entries(results).filter(([, r]) => !r.ok).map(([part, r]) => ({ part, detail: r.detail.slice(0, 200) })),
  };
}

/** يُقرأ بحذر — صفٌّ كتبته نسخةٌ أقدم أو تالف يصير `null` («غير معروف») لا حالاً مخترَعة. */
export function parseHeartbeat(raw: string | null | undefined): BackupHeartbeat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<BackupHeartbeat>;
    if (typeof v.at !== "string" || typeof v.day !== "string" || typeof v.coreOk !== "boolean" || typeof v.driveOk !== "boolean") return null;
    return {
      at: v.at, day: v.day, coreOk: v.coreOk, driveOk: v.driveOk,
      lastCoreSuccess: typeof v.lastCoreSuccess === "string" ? v.lastCoreSuccess : null,
      lastFullSuccess: typeof v.lastFullSuccess === "string" ? v.lastFullSuccess : null,
      failed: Array.isArray(v.failed) ? v.failed.filter((f): f is { part: string; detail: string } => typeof f?.part === "string" && typeof f?.detail === "string") : [],
    };
  } catch {
    return null;
  }
}

/** متى تُعدّ النسخةُ متأخّرة: لا نسخةَ قاعدةٍ في يومين — الجهازُ قد يُغلق يوماً. */
export const BACKUP_STALE_MS = 48 * 60 * 60 * 1000;
/** والمرآةُ أوسعُ أجلاً: الأرشيفُ في الدرايف أصلاً، والمرآةُ نسخةٌ ثانية منه. */
export const MIRROR_STALE_MS = 4 * 24 * 60 * 60 * 1000;

export type BackupVerdict =
  | { state: "UNKNOWN" }
  | { state: "OK"; hb: BackupHeartbeat }
  | { state: "CORE_STALE"; hb: BackupHeartbeat; sinceMs: number | null }
  | { state: "MIRROR_STALE"; hb: BackupHeartbeat; sinceMs: number | null };

/** حكمٌ واحد لصفحة الإعدادات و«يحتاج قرارك». */
export function backupVerdict(hb: BackupHeartbeat | null, now: Date): BackupVerdict {
  if (!hb) return { state: "UNKNOWN" };
  const age = (iso: string | null) => (iso ? now.getTime() - new Date(iso).getTime() : null);
  const core = age(hb.lastCoreSuccess);
  if (core === null || core > BACKUP_STALE_MS) return { state: "CORE_STALE", hb, sinceMs: core };
  const full = age(hb.lastFullSuccess);
  if (full === null || full > MIRROR_STALE_MS) return { state: "MIRROR_STALE", hb, sinceMs: full };
  return { state: "OK", hb };
}
export function shouldNotify(last: LastRun, today: string, now: Date): boolean {
  if (last.notifiedDay === today) return false;
  if (!last.lastSuccess) return true;
  return now.getTime() - new Date(last.lastSuccess).getTime() > ALERT_AFTER_MS;
}

/**
 * أيّامٌ فشلت نسختُها الأساسيّة وتسبق آخرَ يومٍ كامل — لا فيها ما ليس في الكامل بعدها، فتُكنس.
 * ولا يُعدّ «فاشلاً» إلّا ما اسمُه تاريخ (`.DS_Store` كُنس مرّةً على أنّه يوم).
 */
export function failedDaysToPrune(days: readonly { day: string; ok: boolean }[]): string[] {
  const dated = days.filter((d) => DAY.test(d.day));
  const lastOk = dated.filter((d) => d.ok).map((d) => d.day).sort().at(-1);
  if (!lastOk) return [];
  return dated.filter((d) => !d.ok && d.day < lastOk).map((d) => d.day).sort();
}

/**
 * أاكتملت نسخةُ ذلك اليوم الأساسيّة؟ — من تقريره كما كُتب، بأيّ نسخةٍ من النصّ كتبته.
 *
 * ── الخطأ الذي كتب هذه الدالّة (٢٢ نوفمبر ٢٠٢٦) ──
 * صار التقريرُ يحمل `coreOk`، وقُرئت التقاريرُ الأقدم بـ`ok` (القاعدةُ **والدرايف**) — والدرايفُ تعذّر
 * منذ ٣١ أكتوبر، فعُدّت أيّامُ ١–٢١ نوفمبر «ناقصة» وكُنست ونسخُ القاعدة فيها سليمة. فالتقريرُ الأقدم
 * يُحكم بأجزائه (`results`) لا بخلاصته، وما لا يُقرأ يُعدّ سليماً: الشكُّ لا يحذف.
 */
export function reportCoreOk(report: { ok?: unknown; coreOk?: unknown; results?: unknown } | null): boolean {
  if (!report) return true;
  if (typeof report.coreOk === "boolean") return report.coreOk;
  if (report.results && typeof report.results === "object") {
    return coreComplete(report.results as Record<string, PartResult>);
  }
  return report.ok !== false;
}

/** ما يُكنس لا يُمحى: يُنقل إلى `.trash/` ويبقى فيه هذه المدّة — كنسٌ خاطئ يُستردّ. */
export const TRASH_KEEP_DAYS = 30;

/**
 * رسالةُ الخطأ من مخرجات نصٍّ فرعيّ: سطرُ «✕» أو «Error» إن وُجد — لا آخرُ ثلاثة أسطر،
 * فقد كانت `}  Node.js v20` ولا تقول شيئاً.
 */
export function errorSummary(output: string): string {
  const lines = output.split("\n").map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => l.startsWith("✕")) ?? lines.find((l) => /\b\w*Error\b[:]/.test(l));
  if (hit) return hit.replace(/^✕\s*/, "").slice(0, 300);
  const tail = lines.filter((l) => !/^Node\.js v\d/.test(l) && !/^[{}]$/.test(l)).slice(-2).join(" ");
  return tail.slice(0, 300) || "توقّف بلا رسالة";
}

/** أخطاءُ شبكةٍ عابرة — تُعاد المحاولة لها. وغيرُها (سرٌّ خاطئ، مخطّطٌ تغيّر) لا تُعاد. */
export function isTransient(message: string): boolean {
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EPIPE|socket hang up|Connection terminated|timeout|invalid authentication credentials|\b5\d\d\b|rate ?limit/i.test(message);
}

/**
 * النسخةُ الثانية خارج القرص (`BACKUP_COPY_ROOT` — مجلّدٌ في iCloud Drive أو قرصٌ خارجيّ): نسخُ الأيّام
 * كلُّها على قرصٍ واحد بلا Time Machine، فعطبُه يذهب بها جميعاً. ما يُنسخ إليها: كلُّ ما في مجلّد اليوم
 * **إلّا الأسرار** (`secrets/`) — كلماتُ المرور والمفاتيح لا تخرج من الجهاز إلّا بطلبٍ صريح
 * (`BACKUP_COPY_SECRETS=1`).
 */
/** ما يُنسخ خارج القرص: الأسرارُ بطلبٍ وحده، والشيفرةُ لا (نسختُها الثانية على GitHub) — فيبقى يومُ iCloud نحو ٤٠ م.ب لا ١٠٠. */
export function copyEntries(names: readonly string[], withSecrets: boolean): string[] {
  return names.filter((n) => n !== "code" && (withSecrets || n !== "secrets"));
}

