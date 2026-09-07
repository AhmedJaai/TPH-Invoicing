/**
 * نداء DeepSeek — الطبقة الدنيا، ولا منطق عمل فيها.
 *
 * واجهةٌ متوافقة مع OpenAI، فلا تُضاف حزمة: `fetch` يكفي. وهذا مقصود —
 * الحزمة تُضيف سطح هجومٍ وتحديثاتٍ وحجماً في حزمة النشر، مقابل ما
 * نكتبه هنا في مئة سطر ونفهمه كلّه.
 *
 * ── لماذا الفشل مصنَّف ولا يُرمى نصّاً ──
 *
 * «تعذّر الاتصال» تُقال حين لا يصل الطلب، لا حين يردّ الخادم بخطأ —
 * وإلّا أُرسل صاحب العمل يفحص شبكةً سليمة. فيُفصَل هنا:
 *
 *   NOT_CONFIGURED  — لا مفتاح. خبرٌ يُصلَح في دقيقة.
 *   NO_BALANCE      — المفتاح صحيح والرصيد صفر. وقد وقعت فعلاً.
 *   AI_UNAVAILABLE  — الخادم لم يردّ، أو ردّ بعطبٍ عنده.
 *   INVALID_RESPONSE— ردّ بما لا يُقرأ. عطبٌ في المخرَج لا في الشبكة.
 *
 * والفرق ليس تجميلاً: الثلاثة الأخيرة تُوقف المستند إلى مراجعةٍ بشرية،
 * والأوّل يُصلحه أحمد بنفسه ولا ينتظر أحداً.
 */
import { createHash } from "node:crypto";
import {
  deepseekBaseUrl,
  deepseekKey,
  estimateCostUsd,
  modelFor,
  type AiTask,
} from "./models";

export type DeepseekFailureKind =
  | "NOT_CONFIGURED"
  | "NO_BALANCE"
  | "AI_UNAVAILABLE"
  | "INVALID_RESPONSE";

export interface DeepseekUsage {
  inputTokens: number;
  outputTokens: number;
  /** رموز التفكير — يفصلها المزوّد، وهي محسوبة في الكلفة. */
  reasoningTokens: number;
  /** ما قُرئ من الخزين — يخفض الكلفة فعلاً، فيُسجَّل. */
  cachedTokens: number;
}

export interface DeepseekSuccess {
  ok: true;
  text: string;
  model: string;
  task: AiTask;
  durationMs: number;
  usage: DeepseekUsage;
  estimatedCostUsd: number;
  attempts: number;
}

export interface DeepseekFailure {
  ok: false;
  kind: DeepseekFailureKind;
  reason: string;
  model: string;
  task: AiTask;
  durationMs: number;
  attempts: number;
  status?: number;
}

export type DeepseekResult = DeepseekSuccess | DeepseekFailure;

/** جزءٌ من رسالة: نصّ أو صورة. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface DeepseekMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface DeepseekCall {
  task: AiTask;
  messages: DeepseekMessage[];
  maxTokens: number;
  /** يُطلَب JSON. والمخطّط الصارم غير متاح عند هذا المزوّد، فيُوصَف في الموجِّه ويُتحقَّق بعدُ. */
  json?: boolean;
  /** سقفُ انتظارٍ لكلّ محاولة. المزوّد قد يصمت، والصمت أسوأ من الخطأ. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * أيفكّر النموذج قبل أن يجيب؟
   *
   * وبلا تصريحٍ يُقرَّر بالمهمّة، وهو الصواب في أكثر المواضع — انظر
   * `thinkingFor`.
   */
  thinking?: boolean;
}

/**
 * التفكير يتبع المهمّة.
 *
 * ── ولماذا يُطفَأ في القراءة ──
 *
 * قراءةُ الفاتورة **نقلٌ لا استدلال**: يُنسَخ ما هو مطبوع. والتعليمات
 * تقول ذلك صراحةً — «انسخ الأرقام كما هي حرفياً، لا تحسب ولا تصحّح ولا
 * تستنتج مبلغاً غائباً». فالتفكير فيها لا يضيف صواباً، وقد يُنقصه:
 * نموذجٌ يُطيل النظر في رقمٍ مطبوع قد يُقنع نفسه بغيره.
 *
 * وكلفتُه قيست: فاتورةٌ من ٢٨٢ كلمة استغرقت ١١١ ثانية ثمّ **انقطع
 * مخرَجُها عند ١٦٠٠٠ رمز** — لأنّ رموز التفكير تُحسَب من السقف نفسه.
 * أي أنّ التفكير لم يُبطئ القراءة فحسب، بل منعها.
 *
 * ── ويُشعَل في التحكيم ──
 *
 * الترجيح بين مرشّحين استدلالٌ فعلاً: أيّ فاتورةٍ تفسّر هذه الحوالة،
 * وهل يفسّرها مجموعُ اثنتين. وهناك يُدفَع ثمنُ التفكير عن حقّ.
 */
export function thinkingFor(task: AiTask): boolean {
  return task === "REASONING";
}

/**
 * ما يستحقّ إعادة المحاولة.
 *
 * ٤٢٩ ضغطٌ لحظيّ، والخمسمئة عطبٌ عند المزوّد — كلاهما يزول. وما عداها
 * لا يزول بالتكرار: ٤٠٠ طلبٌ خاطئ، و٤٠١ مفتاحٌ باطل، و**٤٠٢ رصيدٌ
 * نفد** — وإعادة المحاولة عليها تُضيّع الوقت وتُخفي السبب.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 90_000;

function retryBaseMs(): number {
  const raw = Number(process.env.DEEPSEEK_RETRY_BASE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 800;
}

const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** بصمة محتوى — للأثر والخزين، ولا تحمل المحتوى نفسه. */
export function contentHash(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

interface RawResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_cache_hit_tokens?: number;
  };
  error?: { message?: string };
}

/**
 * ينادي المزوّد ويردّ نتيجةً مصنَّفة.
 *
 * ولا يرمي أبداً: كلّ عطبٍ يعود قيمةً. لأنّ المستدعي مسارٌ ماليّ، ورميُ
 * استثناءٍ فيه يعني إمّا `try` في كل موضع أو سقوطَ الطلب كلّه — وكلاهما
 * يُنتج حالاً لا يعرف أحدٌ فيها أوقع المال أم لا.
 */
export async function callDeepseek(call: DeepseekCall): Promise<DeepseekResult> {
  const model = modelFor(call.task);
  const started = Date.now();
  const key = deepseekKey();

  if (!key) {
    return {
      ok: false,
      kind: "NOT_CONFIGURED",
      reason: "مفتاح DEEPSEEK_API_KEY غير مضبوط",
      model,
      task: call.task,
      durationMs: 0,
      attempts: 0,
    };
  }

  const thinking = call.thinking ?? thinkingFor(call.task);

  const body = JSON.stringify({
    model,
    temperature: 0,
    max_tokens: call.maxTokens,
    ...(call.json ? { response_format: { type: "json_object" } } : {}),
    ...(thinking ? {} : { thinking: { type: "disabled" } }),
    messages: call.messages,
  });

  let lastReason = "";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    /*
      مهلةٌ لكلّ محاولة على حدة.

      ووصلُ إشارة المستدعي بإشارتنا مقصود: إن ألغى الطلبَ من فوقنا
      وجب أن ينقطع النداء، وإلّا بقي معلَّقاً يستهلك اتصالاً بعد أن
      انصرف صاحبه.
    */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    call.signal?.addEventListener("abort", onAbort);

    let response: Response;
    try {
      response = await fetch(`${deepseekBaseUrl()}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      lastReason =
        (e as Error).name === "AbortError"
          ? `تجاوز النداء المهلة (${(call.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000} ثانية)`
          : `تعذّر الوصول إلى المزوّد: ${(e as Error).message}`;
      if (attempt < MAX_ATTEMPTS) {
        await wait(retryBaseMs() * 2 ** (attempt - 1));
        continue;
      }
      return {
        ok: false, kind: "AI_UNAVAILABLE", reason: lastReason,
        model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
      };
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", onAbort);
    }

    if (!response.ok) {
      lastStatus = response.status;
      const text = await response.text().catch(() => "");

      if (response.status === 402) {
        return {
          ok: false, kind: "NO_BALANCE",
          reason: "رصيد حساب DeepSeek نفد — يُشحَن الحساب ثمّ تُعاد المحاولة",
          model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
          status: 402,
        };
      }
      if (response.status === 401) {
        return {
          ok: false, kind: "NOT_CONFIGURED", reason: "مفتاح DeepSeek غير صالح",
          model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
          status: 401,
        };
      }
      if (response.status === 404) {
        return {
          ok: false, kind: "AI_UNAVAILABLE",
          reason: `النموذج ${model} غير متاح لهذا المفتاح`,
          model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
          status: 404,
        };
      }

      lastReason = `المزوّد ردّ ${response.status}: ${text.slice(0, 160)}`;
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        await wait(retryBaseMs() * 2 ** (attempt - 1));
        continue;
      }
      return {
        ok: false, kind: "AI_UNAVAILABLE", reason: lastReason,
        model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
        status: response.status,
      };
    }

    let payload: RawResponse;
    try {
      payload = (await response.json()) as RawResponse;
    } catch {
      return {
        ok: false, kind: "INVALID_RESPONSE", reason: "ردّ المزوّد ليس JSON",
        model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
      };
    }

    const choice = payload.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";

    /*
      الانقطاع عند السقف ليس نجاحاً ناقصاً — هو فشل.

      المخرَج المقطوع JSON غير مكتمل، وقبولُه يعني حقولاً تُقرأ نصفها.
      وفي مستندٍ ماليّ نصفُ الرقم أسوأ من لا رقم.
    */
    if (choice?.finish_reason === "length") {
      return {
        ok: false, kind: "INVALID_RESPONSE",
        reason: "انقطع المخرَج عند سقف الرموز قبل أن يكتمل",
        model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
      };
    }
    if (!text) {
      return {
        ok: false, kind: "INVALID_RESPONSE", reason: "لم يُرجع المزوّد محتوى",
        model, task: call.task, durationMs: Date.now() - started, attempts: attempt,
      };
    }

    const usage: DeepseekUsage = {
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      cachedTokens: payload.usage?.prompt_cache_hit_tokens ?? 0,
    };

    return {
      ok: true,
      text,
      model,
      task: call.task,
      durationMs: Date.now() - started,
      usage,
      estimatedCostUsd: estimateCostUsd(call.task, usage),
      attempts: attempt,
    };
  }

  return {
    ok: false, kind: "AI_UNAVAILABLE", reason: lastReason || "نفدت المحاولات",
    model, task: call.task, durationMs: Date.now() - started, attempts: MAX_ATTEMPTS,
    status: lastStatus,
  };
}

/**
 * يقشّر سياج الشيفرة ثمّ يحلّل.
 *
 * `json_object` يعد بـJSON ولا يضمن خلوّه من ```json — والوعد الذي لا
 * يُفرَض يُتحقَّق منه.
 */
export function parseJsonLoose(text: string): { ok: true; value: unknown } | { ok: false } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch {
    /*
      محاولةٌ أخيرة: يلتقط أوّل كائنٍ متوازن الأقواس.

      بعض المخرَجات تسبقها جملةٌ تفسيرية رغم الطلب. وهذا ليس تساهلاً
      في الصحّة — ما يُلتقَط يمرّ على zod بعدُ كأيّ مخرَجٍ آخر.
    */
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return { ok: true, value: JSON.parse(cleaned.slice(start, end + 1)) };
      } catch {
        return { ok: false };
      }
    }
    return { ok: false };
  }
}

/**
 * يشتغل على دفعةٍ بتزامنٍ محدود.
 *
 * و`Promise.all` على مئة مستند يفتح مئة اتصال، فيردّ المزوّد ٤٢٩ على
 * أكثرها — فيبدو العطب «حدّ طلبات» وهو في الحقيقة سوء إدارةٍ عندنا.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}
