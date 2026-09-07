/**
 * مزوّد DeepSeek — قراءة المستندات.
 *
 * ── المخطّط في الموجِّه، لا في الطلب ──
 *
 * جيميني يقبل `responseSchema`، وكلود يقبل `zodOutputFormat` — كلاهما
 * **يفرض** البنية فرضاً. وDeepSeek لا يقبل `json_schema`؛ جرّبناه فردّ
 * ٤٠٠: «This response_format type is unavailable now». المتاح
 * `json_object` وحده: JSON صالح، بلا ضمانٍ لحقوله.
 *
 * وهذا تراجعٌ في الضمان يجب أن يُقال صراحةً لا أن يُغطّى. وأثره أنّ
 * **التحقّق بعد القراءة صار حاملاً للصحّة لا تحسيناً لها**: يُوصَف
 * المخطّط في الموجِّه، ثمّ يُتحقَّق بـzod، ثمّ يُعاد السؤال موجَّهاً
 * إن اختلّ. الطبقات الثلاث تُعوّض ما لا تفرضه الواجهة.
 *
 * ── والقراءة على مرحلتين ──
 *
 * يُصنَّف المستند بسؤالٍ رخيص، ثمّ يُطلَب مخطّط نوعه وحده. وهذا ليس
 * جديداً: `schemas-by-kind.ts` مبنيٌّ ومختبَر، وكان **مزوّد كلود وحده**
 * يستعمله — بينما جيميني (وهو ما يعمل في الإنتاج) يطلب المخطّط الضخم
 * لكلّ شيء: ثلاثون حقلاً يُسأل عنها النموذج وهو يقرأ فاتورةً فيها ستّة.
 *
 * فالانتقال إلى DeepSeek ينقل الإنتاج إلى المسار الأفضل أيضاً — وهذا
 * كسبٌ من المعمارية لا من النموذج، ويجب ألّا يُنسب إلى النموذج عند
 * القياس.
 */
import { z } from "zod";
import { extractionSchema } from "./schema";
import { classifierSchema, schemaFor, widen, type DocumentKind } from "./schemas-by-kind";
import {
  buildInstructions,
  type ExtractionOutcome,
  type ExtractionProvider,
  type ExtractionRequest,
} from "./provider";
import { callDeepseek, parseJsonLoose, type DeepseekMessage, type ContentPart } from "@/lib/ai/deepseek";
import { isDeepseekConfigured } from "@/lib/ai/models";
import { resolveDocumentInput, type DocumentInput } from "@/lib/ai/document-input";
import { detailFor } from "@/lib/ai/pdf-images";
import { describeConflicts, findConflicts } from "./validate-extraction";

/**
 * يصف المخطّط للنموذج.
 *
 * مولَّدٌ من zod لا مكتوبٌ بيد: النسختان تفترقان حتماً إن كُتبتا
 * مرّتين، وحين تفترقان يُطلَب من النموذج شكلٌ ويُتحقَّق من شكلٍ آخر —
 * فتُرفَض قراءاتٌ صحيحة ولا يُعرَف السبب.
 */
function schemaPrompt(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, { io: "output" });
  return JSON.stringify(json);
}

const JSON_RULE =
  "أجب بكائن JSON واحد يطابق هذا المخطّط حرفياً، بلا أيّ نصّ قبله أو بعده وبلا سياج شيفرة. " +
  "كلّ حقلٍ في المخطّط مطلوب: ما لم يظهر في المستند اتركه نصّاً فارغاً \"\" ولا تخترع له قيمة.";

/** يبني أجزاء الرسالة من المستند — نصّاً أو صوراً. */
function documentParts(input: DocumentInput): ContentPart[] {
  if (input.mode === "TEXT") {
    return [
      {
        type: "text",
        text:
          "نصّ المستند مستخرَجٌ من الملفّ بمواضعه، والصفوف محفوظة:\n\n" +
          "<<<DOCUMENT>>>\n" +
          input.text +
          "\n<<<END DOCUMENT>>>",
      },
    ];
  }
  if (input.mode === "IMAGE") {
    return input.images.map((img) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mimeType};base64,${img.data.toString("base64")}`,
        detail: detailFor(img),
      },
    }));
  }
  return [];
}

/**
 * سقفُ المخرَج يتبع ما يُقرأ.
 *
 * كان ١٦٠٠٠ لكلّ شيء. والفاتورة من ثلاثة بنود مخرَجُها أربعُ مئة رمز،
 * والكشفُ ذو الستّين سطراً يحتاج آلافاً. فسقفٌ واحد إمّا ضيّقٌ على
 * الكشف أو واسعٌ بلا معنى على الفاتورة.
 *
 * والسقف لا يُدفَع ثمنُه إن لم يُستهلَك — لكنّه يُخفي الانقطاع: مخرَجٌ
 * ينقطع عند ١٦٠٠٠ لا يُعرَف أطال المستندُ أم ضلّ النموذج.
 *
 * والأرقام من القياس على الأرشيف لا من التخمين: أطولُ مخرَجِ فاتورةٍ
 * في ١٢٦ فاتورة كان دون الألفين.
 */
function ceilingFor(kind: DocumentKind | null): number {
  return kind === "STATEMENT" ? 16000 : 6000;
}

/** أيّ نموذج يقرأ هذا المستند: نصّيٌّ رخيص أم رؤية. */
function taskFor(input: DocumentInput): "TEXT" | "VISION" {
  return input.mode === "TEXT" ? "TEXT" : "VISION";
}

async function extractWithDeepseek(request: ExtractionRequest): Promise<ExtractionOutcome> {
  if (!isDeepseekConfigured()) {
    return {
      ok: false,
      provider: "deepseek",
      reason: "مفتاح DEEPSEEK_API_KEY غير مضبوط",
    };
  }

  const input = await resolveDocumentInput(request.data, request.mimeType);
  if (input.mode === "UNREADABLE") {
    return { ok: false, provider: "deepseek", reason: input.reason };
  }

  const task = taskFor(input);
  const parts = documentParts(input);
  const instructions = buildInstructions(
    request.companyVat,
    request.companyName,
    request.supplierNames,
  );

  let inputTokens = 0;
  let outputTokens = 0;

  /* ── المرحلة الأولى: ما هذا المستند؟ ── */
  const classified = await callDeepseek({
    task,
    maxTokens: 400,
    json: true,
    messages: [
      { role: "system", content: instructions },
      {
        role: "user",
        content: [
          ...parts,
          {
            type: "text",
            text:
              "ما نوع هذا المستند؟ صنّفه ولا تستخرج حقوله.\n" +
              JSON_RULE +
              "\nالمخطّط: " +
              schemaPrompt(classifierSchema),
          },
        ],
      },
    ],
  });

  let kind: DocumentKind | null = null;
  let kindConfidence = 0;

  if (classified.ok) {
    inputTokens += classified.usage.inputTokens;
    outputTokens += classified.usage.outputTokens;
    const parsed = parseJsonLoose(classified.text);
    if (parsed.ok) {
      const c = classifierSchema.safeParse(parsed.value);
      if (c.success) {
        kind = c.data.documentKind;
        kindConfidence = c.data.confidence;
      }
    }
  } else if (classified.kind === "NOT_CONFIGURED" || classified.kind === "NO_BALANCE") {
    /*
      عطبٌ لا يزول بالمضيّ — لا يُكمَل إلى المرحلة الثانية.
      وإكمالُها يعني نداءً ثانياً يفشل بالسبب نفسه ويُضاعف الانتظار.
    */
    return { ok: false, provider: "deepseek", reason: classified.reason };
  }

  /*
    وإن تعذّر التصنيف مضى المسار بالمخطّط الكامل — ولا يُفترَض نوع.
    وافتراضُ «فاتورة» هنا يعني ألّا يُسأل عن أرصدة كشفٍ في كشف حساب.
  */
  const targetSchema = kind ? schemaFor(kind) : extractionSchema;

  const askMessages: DeepseekMessage[] = [
    { role: "system", content: instructions },
    {
      role: "user",
      content: [
        ...parts,
        {
          type: "text",
          text:
            (kind
              ? `هذا المستند مصنَّفٌ ${kind}. استخرج حقوله.`
              : "استخرج حقول هذا المستند.") +
            "\n" +
            JSON_RULE +
            "\nالمخطّط: " +
            schemaPrompt(targetSchema),
        },
      ],
    },
  ];

  /* ── المرحلة الثانية، ومعها إعادةٌ موجَّهة عند الاختلال ── */
  let lastReason = "";
  let ceiling = ceilingFor(kind);

  for (let pass = 1; pass <= 3; pass++) {
    /*
      سقفٌ سخيّ عمداً.

      نماذج DeepSeek تُفكّر قبل أن تجيب، و**رموز التفكير تُحسَب من
      `max_tokens` نفسه**. فسقفُ ٨٠٠٠ كان يكفي الجواب ولا يكفي التفكير
      قبله: انقطع مخرَجُ فاتورةٍ من ثلاثة بنود عند الحدّ فرُدَّت القراءة
      كلّها. والانقطاع لا يُرى في الجواب — يُرى في `finish_reason`.
    */
    const response = await callDeepseek({ task, maxTokens: ceiling, json: true, messages: askMessages });

    if (!response.ok) {
      if (response.kind === "NOT_CONFIGURED" || response.kind === "NO_BALANCE") {
        return { ok: false, provider: "deepseek", reason: response.reason };
      }
      /*
        الانقطاع وحده يُعاد عليه بسقفٍ أعلى — مرّةً واحدة.

        ولا يُرفَع السقف عالمياً: مستندٌ واحد طويل لا يجعل كلّ فاتورةٍ
        تحتاج ستّةَ عشر ألفاً. ومرّةً واحدة لأنّ الرفع بلا حدّ يُنفق
        على مخرَجٍ لا يكتمل مهما رُفع.
      */
      if (response.truncated && ceiling < 16000) {
        ceiling = 16000;
        lastReason = response.reason;
        continue;
      }
      lastReason = response.reason;
      break;
    }

    inputTokens += response.usage.inputTokens;
    outputTokens += response.usage.outputTokens;

    const parsed = parseJsonLoose(response.text);
    if (!parsed.ok) {
      lastReason = "مخرَج النموذج ليس JSON صالحاً";
      askMessages.push(
        { role: "assistant", content: response.text.slice(0, 400) },
        { role: "user", content: `${lastReason}. أعد الجواب بكائن JSON واحد فقط.` },
      );
      continue;
    }

    const shaped = targetSchema.safeParse(parsed.value);
    if (!shaped.success) {
      const missing = shaped.error.issues.slice(0, 6).map((i) => i.path.join(".")).join("، ");
      lastReason = `مخرَج ناقص: ${missing}`;
      askMessages.push(
        { role: "assistant", content: response.text.slice(0, 400) },
        {
          role: "user",
          content:
            `نقصت حقول أو خالفت أنواعها: ${missing}. ` +
            "أعد الجواب كاملاً بالمخطّط نفسه، واترك ما لم يظهر في المستند فارغاً.",
        },
      );
      continue;
    }

    const value = extractionSchema.parse(
      kind ? widen(kind, shaped.data as Record<string, unknown>, kindConfidence) : shaped.data,
    );

    /*
      ── التحقّق الحسابيّ، وإعادةُ سؤالٍ موجَّهة ──

      §١١: لا يُستدعى نموذجٌ أقوى لكلّ فشل. يُقال للنموذج **ما اختلّ
      بعينه** ويُطلَب منه إعادةُ قراءة تلك الحقول وحدها. وأكثر الاختلال
      خطأُ قراءةٍ في رقم واحد، لا عجزٌ عن الفهم.
    */
    const conflicts = findConflicts(value);
    if (conflicts.length === 0 || pass === 2) {
      return {
        ok: true,
        provider: "deepseek",
        value,
        model: response.model,
        usage: { inputTokens, outputTokens },
      };
    }

    askMessages.push(
      { role: "assistant", content: response.text.slice(0, 600) },
      { role: "user", content: describeConflicts(conflicts) },
    );
    lastReason = conflicts.map((c) => c.message).join(" · ");
  }

  return {
    ok: false,
    provider: "deepseek",
    reason: lastReason || "تعذّر استخراج حقول هذا المستند",
  };
}

export const deepseekExtractionProvider: ExtractionProvider = {
  name: "deepseek",
  isConfigured: isDeepseekConfigured,
  extract: extractWithDeepseek,
};
