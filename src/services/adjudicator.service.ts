/**
 * الحَكَم: الاستدعاء الفعليّ.
 *
 * كان `adjudicate.ts` يقرّر **متى** يستحقّ الالتباسُ حَكَماً، ولا
 * يستدعيه. فالحلقة مقطوعة: يُقال «هذه تستحقّ» ثمّ لا شيء.
 *
 * وهنا تُغلَق. والقيود الأربعة التي تحكمها:
 *
 *   ١. لا يُستدعى إلّا لما قرّره المخطِّط — لا لكلّ حركة.
 *   ٢. يُعطى مرشّحين مولَّدين حسابياً، ولا يخترع واحداً.
 *   ٣. حكمه يُتحقَّق منه في الخادم قبل قبوله.
 *   ٤. حكمه **لا يُطابِق تلقائياً**: يرفع الحالة إلى «اقتراح» لا إلى
 *      «مطابَقة». فالنموذج يرجّح، والإنسان يُقرّ.
 */
import { z } from "zod";
import {
  adjudicationSchema, buildAdjudicationPrompt, validateVerdict,
  type AdjudicationVerdict,
} from "@/lib/bank/adjudicator-prompt";
import type { AdjudicationCase } from "@/lib/bank/adjudicate";
import type { Candidate } from "@/lib/bank/candidates";
import type { CanonicalTransaction } from "@/lib/bank/canonical";
import { PINNED_MODELS, PROMPT_VERSION, SCHEMA_VERSION } from "@/lib/extraction/versions";

export interface InvoiceLabel {
  number: string | null;
  date: string;
  outstandingMinor: number;
}

export interface AdjudicationOutcome {
  transactionId: string;
  /** ما اختاره الحَكَم بعد التحقّق — `null` يعني «لا شيء». */
  candidate: Candidate | null;
  confidence: number;
  reason: string;
  /** لماذا رُدّ حكمه، إن رُدّ. */
  refused: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  durationMs: number;
}

/** واجهة الحَكَم — تُحقن كي يُختبَر بلا شبكة. */
export interface AdjudicatorClient {
  name: string;
  model: string;
  isConfigured(): boolean;
  judge(prompt: string): Promise<{ verdict: AdjudicationVerdict; durationMs: number }>;
}

/**
 * أقصى ما يُحكَّم فيه في الدفعة الواحدة.
 *
 * والحدّ ليس بخلاً بل حماية: دفعةٌ فيها مئتا التباس ليست حالةً تُحكَّم،
 * بل علامةٌ على أنّ البيانات ناقصة — ومعالجتها بمئتَي استدعاء تُخفي
 * السبب وتدفع ثمنه.
 */
export const MAX_CASES_PER_RUN = 25;

export async function adjudicate(
  client: AdjudicatorClient,
  cases: readonly AdjudicationCase[],
  transactions: ReadonlyMap<string, CanonicalTransaction>,
  invoiceLabels: ReadonlyMap<string, InvoiceLabel>,
): Promise<AdjudicationOutcome[]> {
  if (!client.isConfigured()) return [];

  const out: AdjudicationOutcome[] = [];

  for (const c of cases.slice(0, MAX_CASES_PER_RUN)) {
    const tx = transactions.get(c.transactionId);
    // بلا مرشّحين لا حكم: الحَكَم يختار ولا يبتكر
    if (!tx || c.candidates.length === 0) continue;

    const { prompt, map } = buildAdjudicationPrompt(tx, c.candidates, invoiceLabels);

    let verdict: AdjudicationVerdict;
    let durationMs = 0;
    try {
      const result = await client.judge(prompt);
      verdict = result.verdict;
      durationMs = result.durationMs;
    } catch (e) {
      out.push({
        transactionId: c.transactionId,
        candidate: null,
        confidence: 0,
        reason: "",
        refused: `تعذّر الاستدعاء: ${(e as Error).message.slice(0, 120)}`,
        provider: client.name,
        model: client.model,
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        durationMs: 0,
      });
      continue;
    }

    const checked = validateVerdict(verdict, map);

    out.push({
      transactionId: c.transactionId,
      candidate: checked.candidate,
      confidence: verdict.confidence,
      reason: verdict.reason,
      refused: checked.rejected,
      provider: client.name,
      model: client.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      durationMs,
    });
  }

  return out;
}

/**
 * حكم الحَكَم يرفع الحالة إلى «اقتراح» لا إلى «مطابَقة».
 *
 * وهذا القيد هو ما يجعل استعماله آمناً: النموذج يرجّح بين معلومات
 * حُسبت، ثمّ يُقرّ الإنسان. ولو طابَق تلقائياً لصار مصدر قرارٍ ماليّ —
 * وهو ليس كذلك ولا يجوز أن يكون.
 */
export function toSuggestion(o: AdjudicationOutcome): {
  disposition: "SUGGEST" | "REVIEW";
  reasons: string[];
} {
  if (o.refused) {
    return { disposition: "REVIEW", reasons: [`الحَكَم رُدّ حكمه: ${o.refused}`] };
  }
  if (!o.candidate) {
    return {
      disposition: "REVIEW",
      reasons: ["الحَكَم لم يرجّح شيئاً — والترك أسلم من نسبة مالٍ إلى فاتورة لم تُدفع"],
    };
  }
  return {
    disposition: "SUGGEST",
    reasons: [
      `رجّحه الحَكَم (${o.provider}): ${o.reason}`,
      "وهو ترجيحٌ ينتظر إقرارك — النموذج لا يُقرّر مالاً",
    ],
  };
}

/**
 * حَكَمٌ يعمل بمزوّد جيميني.
 *
 * ولا يُستعمل مخطّط الاستخراج هنا: السؤال مختلف والحقول أربعة.
 */
export function geminiAdjudicator(): AdjudicatorClient {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? PINNED_MODELS.gemini;

  return {
    name: "gemini",
    model,
    isConfigured: () => Boolean(key),
    async judge(prompt: string) {
      const started = Date.now();
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key ?? "" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              // صفر: الحكم على نفس المدخل يجب أن يثبت
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  choice: { type: "STRING" },
                  confidence: { type: "NUMBER" },
                  reason: { type: "STRING" },
                  rejected: { type: "STRING" },
                },
                required: ["choice", "confidence", "reason"],
              },
            },
          }),
        },
      );

      if (!res.ok) throw new Error(`جيميني ردّ ${res.status}`);

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = adjudicationSchema.safeParse(
        JSON.parse(text) as z.infer<typeof adjudicationSchema>,
      );
      if (!parsed.success) throw new Error("مخرَجٌ لا يطابق المخطّط");

      return { verdict: parsed.data, durationMs: Date.now() - started };
    },
  };
}
