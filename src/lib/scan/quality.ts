/**
 * أهذه صورةٌ تُقرأ؟ — فحصٌ على الجهاز قبل أن تُرسَل.
 *
 * يقول للباريستا فوراً ما يُصلَح بإعادة التصوير: مهزوزة، أو مظلمة، أو فيها لمعةٌ
 * تمحو جزءاً، أو الورقةُ صغيرةٌ في الصورة. وهو تنبيهٌ لا منع — الحَكَمُ قراءةُ
 * الذكاء بعده (`capture-clarity.ts`): أيقرأ المورّدَ والرقمَ والإجمالي أم لا.
 *
 * خالصةٌ — لا متصفّح.
 */
import { downscaleGray } from "./detect";
import type { Raster } from "./geometry";

export type QualityIssue = "BLURRY" | "DARK" | "GLARE" | "SMALL";

export const QUALITY_MESSAGE: Record<QualityIssue, string> = {
  BLURRY: "الصورة مهزوزة. ثبّت الجوال واضغط على الورقة في الشاشة ليضبط التركيز، ثم صوّرها مرة أخرى.",
  DARK: "الصورة مظلمة. صوّرها في مكان أكثر إضاءة.",
  GLARE: "في الصورة لمعة تغطي جزءاً من الورقة. أمِل الجوال قليلاً أو ابعد الورقة عن المصباح.",
  SMALL: "الورقة صغيرة في الصورة. قرّب الجوال حتى تملأ الورقة الشاشة.",
};

/** حدودُ الحكم — على صورةٍ بأطول ضلعٍ `MEASURE_SIDE`. */
export const MEASURE_SIDE = 1000;
export const BLUR_VARIANCE_MIN = 100;
export const DARK_MEAN_MAX = 75;
/** نسبةُ البكسلات المشبعة التي تُعدّ لمعة — حين لا يكون الورقُ كلُّه مشبعاً */
const GLARE_SHARE = 0.025;
/** الورقةُ تمتدّ أقلَّ من نصف الإطار طولاً وعرضاً — بعيدة */
const SMALL_SPAN = 0.5;

export interface QualityReport {
  issues: QualityIssue[];
  /** تباينُ اللابلاسيان: كم في الصورة من حوافّ حادّة. للاختبار وللتشخيص. */
  sharpness: number;
  brightness: number;
}

/** تباينُ اللابلاسيان — الحرفُ الواضح حوافُّه حادّة فيكبر، والمهزوز يتلاشى. */
export function laplacianVariance(gray: Uint8Array, width: number, height: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width];
      sum += v;
      sumSq += v * v;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * @param page الورقة بعد التقويم وقبل التنظيف — التنظيفُ يرفع التباين فيُخفي الاهتزاز.
 * @param span امتدادُ الورقة في الإطار (`frameSpan`) — ١ إن لم يُعرف.
 */
export function assessQuality(page: Raster, span = 1): QualityReport {
  const { gray, width, height } = downscaleGray(page, MEASURE_SIDE);
  const sharpness = laplacianVariance(gray, width, height);
  let total = 0;
  let saturated = 0;
  const hist = new Uint32Array(256);
  for (const v of gray) {
    total += v;
    hist[v]++;
    if (v >= 252) saturated++;
  }
  const brightness = total / gray.length;
  let acc = 0;
  let median = 0;
  for (; median < 256; median++) {
    acc += hist[median];
    if (acc >= gray.length / 2) break;
  }

  const issues: QualityIssue[] = [];
  if (sharpness < BLUR_VARIANCE_MIN) issues.push("BLURRY");
  if (brightness < DARK_MEAN_MAX) issues.push("DARK");
  /* لمعةٌ: بقعةٌ مشبعة والورقُ حولها غيرُ مشبع — لا ورقٌ أبيضُ كلُّه تحت ضوءٍ قويّ */
  if (saturated / gray.length > GLARE_SHARE && median < 235) issues.push("GLARE");
  if (span < SMALL_SPAN) issues.push("SMALL");
  return { issues, sharpness, brightness };
}
