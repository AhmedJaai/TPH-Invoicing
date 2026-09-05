/**
 * كشف صيغة الكشف واختيار موائمه.
 *
 * كان القارئ واحداً مبنيّاً على صيغة الأهلي — يقول التعليق ذلك صراحةً.
 * فأيّ بنكٍ آخر يعني تعديل الملفّ نفسه، وأيّ تغيّر في تصديره يعني
 * تعديلاً آخر. وهذا لا يتوسّع.
 *
 * وهنا يُعلن كلّ موائمٍ ثقتَه بأنّ الملفّ له، ويُختار الأوثق. والدرجة
 * لا نعم/لا: ملفّان قد يصلحان لموائمين، فيُفصل بالأرجح لا بالأوّل.
 */

export interface DetectionSignal {
  /** نصّ الملفّ أو ترويسته — ما يُفحَص. */
  text: string;
  fileName: string;
}

export interface BankSignature {
  id: string;
  name: string;
  /** علاماتٌ تدلّ عليه — كلٌّ ترفع الثقة. */
  markers: readonly (string | RegExp)[];
  /** علاماتٌ تنفيه — وجودها يُسقط الثقة إلى صفر. */
  excludes?: readonly (string | RegExp)[];
}

/**
 * توقيعات البنوك السعودية.
 *
 * والأهليّ وحده هو المجرَّب على ملفّات حقيقية؛ والبقيّة توقيعات
 * معقولة **لم تُختبَر على كشفٍ فعليّ** — وهذا مكتوبٌ كي لا يُظنّ أنّها
 * مضمونة.
 */
export const SIGNATURES: readonly BankSignature[] = [
  {
    id: "SNB",
    name: "الأهلي (SNB)",
    markers: [
      /\bSNB\b/i, "البنك الأهلي", "الأهلي السعودي", "الاهلي السعودي",
      /Saudi\s*National\s*Bank/i, "الأهلي إي كورب",
    ],
  },
  {
    id: "RAJHI",
    name: "الراجحي",
    markers: [/Al\s*Rajhi/i, "الراجحي", "مصرف الراجحي", /\bRJHI\b/i],
  },
  {
    id: "RIYAD",
    name: "الرياض",
    markers: [/Riyad\s*Bank/i, "بنك الرياض", /\bRIBL\b/i],
  },
  {
    id: "ALINMA",
    name: "الإنماء",
    markers: [/Alinma/i, "مصرف الإنماء", "الانماء", /\bINMA\b/i],
  },
  {
    id: "SAB",
    name: "SAB",
    markers: [/\bSAB\b/, "البنك السعودي البريطاني", /\bSABB\b/i],
  },
  {
    id: "ANB",
    name: "العربي الوطني",
    markers: [/\bANB\b/, "العربي الوطني", /Arab\s*National/i],
  },
];

/**
 * الشرطة السفلية تفصل كلمةً عن كلمة.
 *
 * `\b` في التعابير النمطية لا تفصل عندها — لأنّها حرفُ كلمة. وأسماء
 * ملفّات البنوك مليئة بها: `E-Statement_SNB_260505.xlsx`. فكانت
 * `\bSNB\b` لا تطابقها، ويُقال «بنك غير معروف» وهو مكتوبٌ في الاسم.
 */
function separated(text: string): string {
  return text.replace(/_/g, " ");
}

function hits(marker: string | RegExp, text: string): boolean {
  const t = separated(text);
  return typeof marker === "string" ? t.includes(marker) : marker.test(t);
}

export interface Detection {
  bankId: string;
  bankName: string;
  confidence: number;
  /** ما دلّ عليه — يُعرَض عند الشكّ. */
  matched: string[];
}

/**
 * يكشف البنك من نصّ الملفّ.
 *
 * والثقة تنمو بعدد العلامات لا بأوّلها: اسمٌ واحد قد يرد عرَضاً في
 * وصف حوالة، أمّا اسمان فدليل.
 */
export function detectBank(signal: DetectionSignal): Detection | null {
  const text = `${signal.fileName} ${signal.text}`;

  let best: Detection | null = null;

  for (const sig of SIGNATURES) {
    if (sig.excludes?.some((m) => hits(m, text))) continue;

    const matched = sig.markers
      .filter((m) => hits(m, text))
      .map((m) => (typeof m === "string" ? m : m.source));

    if (matched.length === 0) continue;

    // علامةٌ واحدة ترجيح، واثنتان دليل، وثلاثٌ يقين عمليّ
    const confidence = Math.min(0.4 + 0.25 * matched.length, 0.95);
    if (!best || confidence > best.confidence) {
      best = { bankId: sig.id, bankName: sig.name, confidence, matched };
    }
  }

  return best;
}

/**
 * اسم البنك للعرض.
 *
 * وحين لا يُعرَف لا يُخمَّن ولا يُنسَب إلى الأهليّ لأنّه الأكثر: يُقال
 * «غير محدَّد» — والقراءة تمضي، فبنية الأعمدة هي التي تُفهَم لا اسم
 * البنك.
 */
export function bankLabel(detection: Detection | null): string {
  return detection?.bankName ?? "غير محدَّد";
}
