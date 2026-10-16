/**
 * فحصُ متغيّرات البيئة عند الإقلاع — **يقول ولا يمنع**.
 *
 * كان المتغيّرُ الناقص يُكتشَف عند أوّل طلبٍ يحتاجه («متغير البيئة … غير مضبوط»
 * في منتصف مزامنة)، والمعطوبُ الاختياريّ يُهمَل بصمت: `DB_POOL_MAX=20` خارجَ
 * حدّه فيُترَك، و`AI_DAILY_BUDGET_USD=ten` لا يُقرأ عدداً فلا سقفَ للإنفاق ولا
 * يقول أحدٌ شيئاً.
 *
 * فهنا مخطّطٌ واحد (zod) يُقرأ مرّةً عند الإقلاع، وما خالفه **سطرٌ في السجلّ
 * وبندٌ في `/api/health`** للمخوَّل. ولا يرمي أبداً: نشرٌ يسقط لمتغيّرٍ يعمل
 * التطبيقُ بدونه اليوم أسوأ من متغيّرٍ ناقص. ولا تُكتب قيمةٌ في أيّ مخرج —
 * الاسمُ والعلّةُ وحدهما.
 */
import { z } from "zod";

export interface EnvProblem {
  name: string;
  /** `missing`: يسقط ما يحتاجه عند أوّل استعمال · `malformed`: مضبوطٌ ولا يُقرأ، فيُهمَل أو يسقط */
  kind: "missing" | "malformed";
  why: string;
}

const present = z.string().trim().min(1);

/** ما يرمي التطبيقُ اليوم عند غيابه — لكن عند الاستعمال لا عند الإقلاع. */
const EXPECTED: Record<string, { schema: z.ZodType; why: string }> = {
  DATABASE_URL: { schema: z.string().regex(/^postgres(ql)?:\/\/\S+$/), why: "سلسلة اتّصال Postgres" },
  AUTH_SECRET: { schema: present, why: "سرّ الجلسات" },
  GOOGLE_CLIENT_ID: { schema: present, why: "الدخول بجوجل والدرايف" },
  GOOGLE_CLIENT_SECRET: { schema: present, why: "الدخول بجوجل والدرايف" },
  COMPANY_VAT_NUMBER: { schema: z.string().regex(/^3\d{13}3$/), why: "خمسة عشر رقماً تبدأ بـ3 وتنتهي به" },
  DRIVE_ACCOUNTS_FOLDER_ID: { schema: present, why: "مجلّد الحسابات في الدرايف" },
  DRIVE_YEAR_2026_FOLDER_ID: { schema: present, why: "مجلّد سنة ٢٠٢٦" },
  DRIVE_YEAR_2027_FOLDER_ID: { schema: present, why: "مجلّد سنة ٢٠٢٧" },
  DEEPSEEK_API_KEY: { schema: present, why: "قراءة المستندات" },
};

/** اختياريٌّ اليوم — يُفحَص شكلُه **إن ضُبط** وحده، وغيابُه ليس مشكلة. */
const OPTIONAL: Record<string, { schema: z.ZodType; why: string }> = {
  TOKEN_ENCRYPTION_KEY: { schema: z.string().min(32), why: "٣٢ حرفاً فأكثر" },
  TOKEN_ENCRYPTION_KEY_PREVIOUS: { schema: z.string().min(32), why: "٣٢ حرفاً فأكثر" },
  DB_POOL_MAX: { schema: z.string().regex(/^([1-9]|10)$/), why: "عدد صحيح من ١ إلى ١٠ — وما عداه يهمل" },
  AI_DAILY_BUDGET_USD: { schema: z.string().regex(/^\d+(\.\d+)?$/), why: "عدد بالدولار — وما لا يقرأ يترك الإنفاق بلا سقف" },
  DEEPSEEK_BASE_URL: { schema: z.string().regex(/^https?:\/\/\S+$/), why: "عنوان يبدأ بـhttp" },
  AUTH_URL: { schema: z.string().regex(/^https?:\/\/\S+$/), why: "عنوان يبدأ بـhttp" },
  EXTRACTION_ALLOW_ALT_PROVIDER: { schema: z.enum(["true", "false"]), why: "true أو false" },
};

/**
 * ما يخالف المخطّط — أسماءٌ وعللٌ بلا قيم. قائمةٌ فارغة = لا شيء يُقال.
 * دالّةٌ خالصة: تأخذ البيئةَ ولا تقرأ `process.env`.
 */
export function checkEnv(env: Record<string, string | undefined>): EnvProblem[] {
  const out: EnvProblem[] = [];
  for (const [name, rule] of Object.entries(EXPECTED)) {
    const value = env[name];
    if (value === undefined || value.trim() === "") out.push({ name, kind: "missing", why: rule.why });
    else if (!rule.schema.safeParse(value).success) out.push({ name, kind: "malformed", why: rule.why });
  }
  for (const [name, rule] of Object.entries(OPTIONAL)) {
    const value = env[name];
    if (value === undefined || value === "") continue;
    if (!rule.schema.safeParse(value).success) out.push({ name, kind: "malformed", why: rule.why });
  }
  return out;
}

/** جملةٌ عربيّة لكلّ مشكلة — لما يُعرَض للمخوَّل في فحص الصحّة. */
export function describeEnvProblem(p: EnvProblem): string {
  return p.kind === "missing"
    ? `${p.name} غير مضبوط (${p.why}) — يسقط ما يحتاجه عند أوّل استعمال`
    : `${p.name} مضبوط ولا يقرأ (${p.why})`;
}
