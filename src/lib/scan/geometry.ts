/**
 * هندسةُ المسح: زوايا الورقة الأربع، وتقويمُ ميلها إلى مستطيل.
 *
 * الباريستا يصوّر الورقة على الكاونتر مائلةً ومن زاوية. فتُعرَف زواياها
 * (`detect.ts` أو يدُه)، ثمّ يُحسب التحويلُ المنظوريّ (homography) من مستطيل
 * الناتج إلى رباعيّ الصورة، ويُؤخذ كلُّ بكسلٍ من موضعه في الأصل.
 *
 * دوالّ خالصة — لا متصفّح. والصورةُ مصفوفةُ RGBA كما يُرجعها `getImageData`.
 */

export interface Point { x: number; y: number }

/** الزوايا بترتيبٍ ثابت: أعلى اليسار، أعلى اليمين، أسفل اليمين، أسفل اليسار. */
export type Quad = readonly [Point, Point, Point, Point];

export interface Raster {
  width: number;
  height: number;
  /** RGBA، أربعةُ بايتات لكلّ بكسل */
  data: Uint8ClampedArray;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** مساحةُ الرباعيّ (صيغة الحذاء) — موجبةٌ أيّاً كان اتّجاهُه. */
export function quadArea(q: Quad): number {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/** رباعيٌّ محدَّبٌ لا تتقاطع أضلاعُه — وإلّا فالتقويمُ يقلب الورقة على نفسها. */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * يرتّب أربع نقاطٍ كيفما جاءت: أعلى اليسار أصغرُها (x+y)، وأسفل اليمين أكبرُها،
 * وأعلى اليمين أكبرُها (x−y)، وأسفل اليسار أصغرُها.
 */
export function orderQuad(points: readonly Point[]): Quad {
  if (points.length !== 4) throw new Error("الورقة لها أربع زوايا.");
  const by = (f: (p: Point) => number, max: boolean) =>
    points.reduce((best, p) => ((max ? f(p) > f(best) : f(p) < f(best)) ? p : best));
  return [
    by((p) => p.x + p.y, false),
    by((p) => p.x - p.y, true),
    by((p) => p.x + p.y, true),
    by((p) => p.x - p.y, false),
  ];
}

/** مقاسُ الورقة بعد التقويم: أطولُ الضلعين المتقابلين، ثمّ يُصغَّر حتّى `maxSide`. */
export function outputSize(q: Quad, maxSide: number): { width: number; height: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * التحويلُ المنظوريّ الذي يأخذ زوايا `from` إلى زوايا `to` — ثمانيةُ مجاهيل تُحلّ
 * بحذف غاوس. يُرجع المصفوفة ٣×٣ صفّاً صفّاً (h33 = 1).
 */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error("زوايا الورقة على خطٍّ واحد، فلا تُقوَّم.");
    [A[col], A[pivot]] = [A[pivot], A[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c <= n; c++) A[r][c] -= f * A[col][c];
    }
  }
  const h = A.map((row, i) => row[n] / row[i]);
  return [...h, 1];
}

export function applyHomography(h: readonly number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/**
 * يقوّم الورقة: لكلّ بكسلٍ في الناتج موضعُه في الأصل، ولونُه بالاستيفاء الخطّيّ
 * الثنائيّ بين جيرانه الأربعة — فلا تتسنّن الحروف.
 */
export function warpQuad(src: Raster, q: Quad, maxSide: number): Raster {
  const { width, height } = outputSize(q, maxSide);
  const rect: Quad = [
    { x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 },
  ];
  const h = homography(rect, q);
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  for (let y = 0; y < height; y++) {
    /* المقام والبسط خطّيّان في x — يُزادان بدل أن يُعاد حسابهما */
    let nx = h[1] * y + h[2];
    let ny = h[4] * y + h[5];
    let nw = h[7] * y + h[8];
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1.001, Math.max(0, nx / nw));
      const sy = Math.min(sh - 1.001, Math.max(0, ny / nw));
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
        const bottom = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
      nx += h[0];
      ny += h[3];
      nw += h[6];
    }
  }
  return { width, height, data: out };
}

/** الصورةُ كلُّها بهامشٍ صغير — حين لا تُكتشف الورقة يبدأ منها الباريستا. */
export function insetQuad(width: number, height: number, ratio = 0.04): Quad {
  const dx = width * ratio;
  const dy = height * ratio;
  return [
    { x: dx, y: dy }, { x: width - dx, y: dy }, { x: width - dx, y: height - dy }, { x: dx, y: height - dy },
  ];
}

/**
 * كم تمتدّ الورقةُ في الإطار — أكبرُ نسبتَي طولها وعرضها إلى طوله وعرضه.
 * لا المساحة: إيصالٌ طويلٌ ضيّق يملأ الإطار طولاً ومساحتُه خُمسُه.
 */
export function frameSpan(q: Quad, width: number, height: number): number {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return Math.max((Math.max(...xs) - Math.min(...xs)) / width, (Math.max(...ys) - Math.min(...ys)) / height);
}
