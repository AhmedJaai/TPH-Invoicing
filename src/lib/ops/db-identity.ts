/**
 * هويّة القاعدة التي نتكلّم معها الآن.
 *
 * السؤال الذي لم يكن يُجاب: **هل تكتب بيئةُ المعاينة في بيانات الإنتاج؟**
 * وكان الجواب افتراضاً — «الأرجح لا». والافتراض هنا ثمنُه أنّ كلّ نشرٍ
 * تجريبيّ يعبث بمالٍ حقيقيّ، ولا يُكتشَف إلّا بعد أن يقع.
 *
 * والإثبات لا يكون بقراءة إعدادات لوحةِ تحكّم، بل بأن تقول **القاعدة
 * نفسها** من هي: مضيفُها، واسمُها، ومعرّفُها الذي لا يتكرّر
 * (`system_identifier` من `pg_control_system()`). فمضيفان مختلفان قد
 * يشيران إلى قاعدةٍ واحدة، واسمان متطابقان قد يكونان قاعدتين.
 *
 * ودوالُّ هذا الملفّ خالصة — تأخذ ما قالته القاعدة وتحكم. والجلبُ في
 * `scripts/check-isolation.ts`.
 */

export interface DbFingerprint {
  /** المضيف كما ورد في سلسلة الاتصال — للعرض لا للحكم. */
  host: string;
  database: string;
  /** معرّف العنقود الذي لا يتكرّر — وهو الحاكم. */
  systemIdentifier: string;
  /** أهي نقطة Neon المجمَّعة؟ */
  pooled: boolean;
  /** البيئة التي قرأت. */
  environment: "production" | "preview" | "development" | "unknown";
}

export type IsolationVerdict = "ISOLATED" | "SHARED" | "UNKNOWN";

export interface IsolationCheck {
  verdict: IsolationVerdict;
  reason: string;
  /** أزواجٌ تشترك في قاعدةٍ واحدة — تُسمّى صراحةً. */
  collisions: [string, string][];
}

/**
 * يقرأ المضيف واسم القاعدة من سلسلة الاتصال بلا كشف كلمة السرّ.
 *
 * ولا تُطبَع السلسلة كاملةً أبداً: هي تحمل كلمة سرّ القاعدة، وطباعتها
 * في سجلٍّ تُسرّبها إلى كلّ من يقرأ السجلّ.
 */
export function parseConnection(url: string | undefined): {
  host: string; database: string; pooled: boolean;
} {
  if (!url) return { host: "—", database: "—", pooled: false };
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      database: u.pathname.replace(/^\//, "") || "—",
      pooled: u.hostname.includes("-pooler."),
    };
  } catch {
    return { host: "غير صالح", database: "—", pooled: false };
  }
}

export function environmentOf(env: Record<string, string | undefined>): DbFingerprint["environment"] {
  const vercel = env.VERCEL_ENV;
  if (vercel === "production") return "production";
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "development";
  if (!env.VERCEL) return "development";
  return "unknown";
}

/**
 * يحكم بالعزل من بصماتٍ جُمعت من بيئاتٍ مختلفة.
 *
 * والحكم على `systemIdentifier` وحده: هو معرّف العنقود، ولا يتكرّر.
 * واسمُ المضيف يخدع — لنقطة Neon الواحدة أسماءٌ مجمَّعة وغيرُ مجمَّعة.
 *
 * **والمجهول ليس عزلاً.** بصمةٌ واحدة لا تُثبت شيئاً: تُعلَن `UNKNOWN`
 * ولا تُقرأ نجاحاً. وهذا هو الفرق بين «أثبتنا العزل» و«لم نرَ تداخلاً».
 */
export function checkIsolation(prints: readonly DbFingerprint[]): IsolationCheck {
  const named = prints.filter((p) => p.environment !== "unknown");

  if (named.length < 2) {
    return {
      verdict: "UNKNOWN",
      reason:
        `لم تُجمَع إلّا ${named.length} بصمة. والعزل لا يُثبَت ببصمةٍ واحدة — ` +
        "شغّل الفحص في الإنتاج والمعاينة كليهما، وقارن.",
      collisions: [],
    };
  }

  const collisions: [string, string][] = [];
  for (let i = 0; i < named.length; i++) {
    for (let j = i + 1; j < named.length; j++) {
      const a = named[i];
      const b = named[j];
      if (a.environment === b.environment) continue;
      if (a.systemIdentifier && a.systemIdentifier === b.systemIdentifier) {
        collisions.push([a.environment, b.environment]);
      }
    }
  }

  if (collisions.length > 0) {
    return {
      verdict: "SHARED",
      reason:
        "قاعدةٌ واحدة تخدم بيئتين: " +
        collisions.map(([a, b]) => `${a} ≡ ${b}`).join("، ") +
        ". فكلّ نشرٍ تجريبيّ يكتب في البيانات الحقيقية.",
      collisions,
    };
  }

  return {
    verdict: "ISOLATED",
    reason: `${named.length} بيئات، ولكلٍّ عنقودُها — لا تداخل.`,
    collisions: [],
  };
}

/** حدودٌ أخرى تُفحَص مع الهويّة. */
export function connectionWarnings(p: DbFingerprint): string[] {
  const out: string[] = [];
  if (!p.pooled) {
    out.push(
      "النقطة غير مجمَّعة — تنفد اتصالاتها تحت Vercel، والوقوف صامتٌ بلا خطأ.",
    );
  }
  if (p.environment === "unknown") {
    out.push("البيئة غير معروفة — `VERCEL_ENV` غير مضبوط.");
  }
  return out;
}
