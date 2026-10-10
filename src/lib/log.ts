/**
 * سطرُ السجلّ — شكلٌ واحد يُقرأ آلةً ويكفي وحده.
 *
 * كان كلُّ موضعٍ يكتب سجلَّه بشكله: `console.error("[route]", e)` هنا و
 * `JSON.stringify({ kind })` هناك. والأوّل يطبع خطأ Drizzle كاملاً — ومعه
 * `params:` بقيم الإدخال: مبالغُ وأسماءُ مورّدين وآيبانات — في سجلٍّ يُحفَظ عند
 * المنصّة ويُصرَّف إلى غيرها. والثاني لا يُجمَع مع الأوّل ولا يُبحَث فيه بمفتاح.
 *
 * فالسطرُ هنا JSON واحد: `kind` يسمّي الحدث، و`at` وقتُه، وما عداهما حقولٌ
 * مسطّحة. والخطأ يُختصَر بـ`describeError`: اسمُه ورمزُه ورسالتُه **بلا قيم
 * الإدخال**، وأربعةُ أسطرٍ من أثره. ولا يُسجَّل جسمُ طلبٍ ولا ترويسة.
 *
 * والتسجيلُ لا يرمي أبداً: سطرٌ ناقص خيرٌ من طلبٍ يسقط لأنّ سجلَّه تعذّر.
 */

export type LogLevel = "error" | "warn" | "info";

export interface ErrorFacts {
  name?: string;
  /** رمز PostgreSQL أو رمزُ النظام — على الخطأ أو على سببه (Drizzle يلفّه). */
  code?: string;
  message: string;
  stack?: string;
}

const MAX_MESSAGE = 300;
const MAX_FIELD = 500;
const STACK_LINES = 4;

/** حقولٌ لا تُكتب قيمُها مهما كان مصدرُها. */
const SECRET_KEY = /cookie|authorization|password|secret|token|api[-_]?key|iban/i;

/** رسالة Drizzle تُلحق `params:` بقيم الإدخال — تُقصّ قبل أيّ تسجيل. */
function scrubMessage(message: string): string {
  return message.split("\nparams:")[0].slice(0, MAX_MESSAGE);
}

export function describeError(e: unknown): ErrorFacts {
  if (e === null || typeof e !== "object") return { message: scrubMessage(String(e)) };
  const err = e as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
  const cause = err.cause !== null && typeof err.cause === "object"
    ? (err.cause as { code?: unknown; message?: unknown })
    : undefined;
  const code = [err.code, cause?.code].find((c): c is string => typeof c === "string" && c.length > 0);
  const own = typeof err.message === "string" ? scrubMessage(err.message) : "";
  /* سببُ القاعدة أدلُّ من «Failed query»: يُلحَق برسالته، مقصوصاً مثلها */
  const why = typeof cause?.message === "string" ? scrubMessage(cause.message) : "";
  const message = (why && why !== own ? `${own} ← ${why}` : own).slice(0, MAX_MESSAGE) || "خطأٌ بلا رسالة";
  return {
    ...(typeof err.name === "string" && err.name !== "Error" ? { name: err.name } : {}),
    ...(code ? { code } : {}),
    message,
    ...(typeof err.stack === "string"
      ? {
          stack: err.stack.split("\nparams:")[0].split("\n").slice(1, 1 + STACK_LINES)
            .map((l) => l.trim()).join(" | "),
        }
      : {}),
  };
}

function safeValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return "[محجوب]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "string") return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return describeError(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => safeValue(key, v));
  if (typeof value === "object") {
    /* مستوًى واحد: كائنٌ أعمق يُكتب نوعُه لا محتواه — لا يُصبّ صفٌّ من القاعدة في السجلّ */
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = v !== null && typeof v === "object" && !(v instanceof Date) ? "[كائن]" : safeValue(k, v);
    }
    return out;
  }
  return undefined;
}

/** يبني السطر ولا يكتبه — وهو ما يُختبَر. */
export function formatLogLine(
  kind: string,
  fields: Record<string, unknown> = {},
  now: Date = new Date(),
): string {
  const line: Record<string, unknown> = { kind, at: now.toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "kind" || key === "at") continue;
    const safe = safeValue(key, value);
    if (safe !== undefined) line[key] = safe;
  }
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({ kind, at: now.toISOString(), logError: "تعذّر تسلسلُ الحقول" });
  }
}

/** يكتب سطراً واحداً في سجلّ الخادم. `kind` اسمٌ ثابت بشرطات: `request-error`. */
export function logEvent(kind: string, fields: Record<string, unknown> = {}, level: LogLevel = "error"): void {
  try {
    const line = formatLogLine(kind, fields);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    /* السجلُّ لا يُسقط ما يسجّله */
  }
}
