/**
 * نموذجُ زوايا الورقة — ما يُعطاه وما يُرجعه، بلا تشغيل.
 *
 * نموذجٌ مدرَّبٌ على صور إيصالاتٍ حقيقيّة (CORD) يتنبّأ بزوايا الورقة الأربع: صورةٌ
 * ٢٢٤×٢٢٤ مُطبَّعة (ImageNet)، وأربعُ خرائط حرارة — كلٌّ لزاوية (أعلى اليسار، أعلى
 * اليمين، أسفل اليمين، أسفل اليسار). Kenneth Thorø Martinsen، رخصة MIT
 * (`public/models/NOTICE.txt`). وتشغيلُه في عامل الاكتشاف (`detect.worker.ts`).
 *
 * والنموذجُ وحده تقديرٌ خشن (٢٢٤ بكسلاً للصورة كلّها)؛ وتُدقَّق زواياه على حافّة الورقة
 * (`refine.ts`)، ويُختار بينه وبين الرقعة البيضاء بما تشهد به الحافّة (`pickBest`).
 *
 * خالصة.
 */
import type { Quad, Raster } from "./geometry";

export const MODEL_SIDE = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

export interface Letterbox { input: Float32Array; scale: number; x0: number; y0: number }

/**
 * الصورةُ مصغّرةً بأطول ضلعٍ ٢٢٤ في وسط مربّعٍ أسود — كما دُرِّب النموذج — بترتيب
 * القنوات أوّلاً (NCHW) ومُطبَّعة.
 */
export function letterbox(src: Raster, side = MODEL_SIDE): Letterbox {
  const scale = side / Math.max(src.width, src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const x0 = Math.floor((side - w) / 2);
  const y0 = Math.floor((side - h) / 2);
  const plane = side * side;
  const input = new Float32Array(3 * plane);
  for (let c = 0; c < 3; c++) input.fill(-MEAN[c] / STD[c], c * plane, (c + 1) * plane);
  /* تصغيرٌ بمتوسّط المربّع — لا بأخذ بكسلٍ واحد، فلا تتسنّن الحوافّ */
  const sums = new Float64Array(w * h * 3);
  const counts = new Uint32Array(w * h);
  const d = src.data;
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(h - 1, (y * scale) | 0);
    for (let x = 0; x < src.width; x++) {
      const t = ty * w + Math.min(w - 1, (x * scale) | 0);
      const i = (y * src.width + x) * 4;
      sums[t * 3] += d[i];
      sums[t * 3 + 1] += d[i + 1];
      sums[t * 3 + 2] += d[i + 2];
      counts[t]++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = y * w + x;
      const n = counts[t] || 1;
      const o = (y + y0) * side + (x + x0);
      for (let c = 0; c < 3; c++) input[c * plane + o] = (sums[t * 3 + c] / n / 255 - MEAN[c]) / STD[c];
    }
  }
  return { input, scale, x0, y0 };
}

/**
 * من خرائط الحرارة إلى الزوايا بإحداثيّات الصورة الأصل — والقمّةُ بمركز ثقل جوارها
 * (أدقُّ من بكسلها الواحد). ويُرجع `confidence`: أضعفُ القمم الأربع، لمن يزن.
 */
export function decodeHeatmaps(heat: Float32Array, box: Letterbox, side = MODEL_SIDE): { quad: Quad; confidence: number } {
  const plane = side * side;
  const pts: { x: number; y: number }[] = [];
  let weakest = Infinity;
  for (let k = 0; k < 4; k++) {
    let best = -Infinity;
    let bi = 0;
    for (let i = 0; i < plane; i++) {
      const v = heat[k * plane + i];
      if (v > best) { best = v; bi = i; }
    }
    weakest = Math.min(weakest, best);
    const px = bi % side;
    const py = (bi / side) | 0;
    /* مركزُ ثقل ٥×٥ حول القمّة — بالقيم الموجبة وحدها */
    let sx = 0, sy = 0, sw = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx, y = py + dy;
        if (x < 0 || y < 0 || x >= side || y >= side) continue;
        const v = heat[k * plane + y * side + x];
        if (v <= 0) continue;
        sx += x * v; sy += y * v; sw += v;
      }
    }
    const cx = sw > 0 ? sx / sw : px;
    const cy = sw > 0 ? sy / sw : py;
    pts.push({ x: (cx - box.x0 + 0.5) / box.scale, y: (cy - box.y0 + 0.5) / box.scale });
  }
  return { quad: [pts[0], pts[1], pts[2], pts[3]], confidence: weakest };
}
