/**
 * الورقةُ رقعةٌ بيضاء — اكتشافُها بلونها الحياديّ، لا بخطوطها ولا بسطوعها وحده.
 *
 * على سجّادٍ مزخرف (صورُ فيصل الحقيقيّة) تغرق الخطوطُ في نسيجه، والسطوعُ وحده يخلط
 * الورقة ببقعه الفاتحة. وما يبقى: الورقُ أبيضُ حياديّ — ألوانُه الثلاثة عاليةٌ ومتقاربة —
 * والسجّادُ والخشبُ والرخامُ الدافئ ملوّنةٌ ولو قليلاً. فيُحسب لكلّ بكسل «ورقيّةٌ»
 * (السطوعُ ناقصاً اللونيّة والنسيج)، وتُجرَّب عتباتٌ من وسيط الصورة إلى أنصعها، ويُسدّ
 * ما أحدثه الحبرُ من ثقوب (إغلاق)، وتُقطع الجسورُ إلى بقع السجّاد (فتح)، ثمّ يُطابَق
 * لكلّ رقعةٍ كبيرة أكبرُ رباعيٍّ داخل غلافها المحدَّب. والفائزُ ما ملأ رباعيَّه وبان
 * على ما حوله.
 *
 * خالصةٌ — لا متصفّح.
 */
import { isConvexQuad, orderQuad, quadArea, type Point, type Quad, type Raster } from "./geometry";

export const REGION_SIDE = 320;

interface Small { w: number; h: number; scale: number; paper: Float32Array; lo: number; hi: number }

/**
 * صورةٌ مصغّرة بقيمة «الورقيّة» لكلّ بكسل: السطوعُ ناقصاً ضعفَي اللونيّة ناقصاً النسيج.
 *
 * النسيجُ يُحسب بضعفِ الدقّة ثمّ يُصغَّر: خطوطُ السجّاد الرماديّة حياديّةٌ فاتحةٌ كالورق،
 * لكنّها خشنةٌ في كلّ موضع، وهوامشُ الورقة ملساء. (والحبرُ خشنٌ أيضاً، ويسدّه الإغلاق.)
 */
function paperness(src: Raster, maxSide: number): Small {
  const fine = sample(src, maxSide * 2);
  const { w: fw, h: fh } = fine;
  /* النسيج: متوسّطُ فرق البكسل عن جيرانه الأربعة */
  const tex = new Float32Array(fw * fh);
  for (let y = 1; y < fh - 1; y++) for (let x = 1; x < fw - 1; x++) {
    const i = y * fw + x;
    const v = fine.lum[i];
    tex[i] = (Math.abs(v - fine.lum[i - 1]) + Math.abs(v - fine.lum[i + 1]) + Math.abs(v - fine.lum[i - fw]) + Math.abs(v - fine.lum[i + fw])) / 4;
  }
  const w = Math.max(1, fw >> 1);
  const h = Math.max(1, fh >> 1);
  const paper = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let lum = 0, chroma = 0, t = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = Math.min(fh - 1, 2 * y + dy) * fw + Math.min(fw - 1, 2 * x + dx);
      lum += fine.lum[i]; chroma += fine.chroma[i]; t += tex[i];
    }
    paper[y * w + x] = Math.max(0, Math.min(255, lum / 4 - 2 * (chroma / 4) - TEXTURE_WEIGHT * (t / 4)));
  }
  const sorted = Float32Array.from(paper).sort();
  return { w, h, scale: fine.scale / 2, paper, lo: sorted[Math.floor(sorted.length * 0.5)], hi: sorted[Math.floor(sorted.length * 0.99)] };
}

/** وزنُ النسيج في الورقيّة */
const TEXTURE_WEIGHT = 3;

function sample(src: Raster, maxSide: number): { w: number; h: number; scale: number; lum: Float32Array; chroma: Float32Array } {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const sr = new Float64Array(w * h);
  const sg = new Float64Array(w * h);
  const sb = new Float64Array(w * h);
  const n = new Uint32Array(w * h);
  const d = src.data;
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(h - 1, (y * scale) | 0);
    for (let x = 0; x < src.width; x++) {
      const t = ty * w + Math.min(w - 1, (x * scale) | 0);
      const i = (y * src.width + x) * 4;
      sr[t] += d[i];
      sg[t] += d[i + 1];
      sb[t] += d[i + 2];
      n[t]++;
    }
  }
  const lum = new Float32Array(w * h);
  const chroma = new Float32Array(w * h);
  for (let t = 0; t < lum.length; t++) {
    const c = n[t] || 1;
    const r = sr[t] / c, g = sg[t] / c, b = sb[t] / c;
    lum[t] = (r + g + b) / 3;
    chroma[t] = Math.max(r, g, b) - Math.min(r, g, b);
  }
  return { w, h, scale, lum, chroma };
}

function morph(mask: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  /* مربّعٌ منفصل: أفقيّاً ثمّ رأسيّاً — خطّيٌّ في نصف القطر */
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const inside = xx >= 0 && yy >= 0 && xx < w && yy < h;
          const s = inside ? src[yy * w + xx] : 0;
          if (dilate ? s : !s) { v = dilate ? 1 : 0; break; }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** الغلافُ المحدَّب (سلسلةُ أندرو). */
function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** أكبرُ رباعيٍّ رؤوسُه من رؤوس الغلاف — بعد تبسيطه إلى بضعة عشر رأساً. */
function largestInscribedQuad(hull: Point[]): Quad | null {
  let pts = hull;
  /* تبسيط: يُسقط الرأسُ الذي أقلُّ مثلثٍ يصنعه مع جاريه حتّى يبقى ١٤ */
  while (pts.length > 14) {
    let minI = 0;
    let minA = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = Math.abs(cross(pts[(i - 1 + pts.length) % pts.length], pts[i], pts[(i + 1) % pts.length]));
      if (a < minA) { minA = a; minI = i; }
    }
    pts = pts.filter((_, i) => i !== minI);
  }
  if (pts.length < 4) return null;
  let best: Quad | null = null;
  let bestA = 0;
  const n = pts.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const q: Quad = [pts[a], pts[b], pts[c], pts[d]];
    const area = quadArea(q);
    if (area > bestA) { bestA = area; best = q; }
  }
  return best ? orderQuad(best) : null;
}

export interface RegionQuad { quad: Quad; fill: number; areaRatio: number; contrast: number; threshold: number }

/** كم عتبةً تُجرَّب بين الوسيط وأنصع ما في الصورة */
const THRESHOLD_STEPS = 14;

/**
 * أفضلُ رقعةٍ بيضاء على هيئة ورقة — بإحداثيّات الصورة الأصل، أو `null`.
 *
 * لا عتبةَ واحدة: خطوطُ السجّاد الرماديّة قريبةٌ من الورق، فعتبةٌ واحدة تضمّهما رقعةً
 * متعرّجة. فتُجرَّب عتباتٌ من وسيط الصورة إلى أنصعها (فكرةُ «المناطق المستقرّة» MSER)،
 * وعند إحداها تنفصل الورقةُ رباعيّاً منتظماً يملأ غلافَه — وهو الفائز.
 */
export function quadFromRegion(src: Raster, maxSide = REGION_SIDE): RegionQuad | null {
  const s = paperness(src, maxSide);
  const { w, h } = s;
  const sorted = Float32Array.from(s.paper).sort();
  const lo = sorted[Math.floor(sorted.length * 0.4)];
  const hi = sorted[Math.floor(sorted.length * 0.985)];
  if (hi - lo < 10) return null;
  const r = Math.max(2, Math.round(Math.max(w, h) / 100));

  let best: RegionQuad | null = null;
  let bestScore = 0;
  for (let k = 0; k < THRESHOLD_STEPS; k++) {
    const t = lo + ((hi - lo) * k) / (THRESHOLD_STEPS - 1);
    let mask: Uint8Array = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = s.paper[i] >= t ? 1 : 0;
    /* إغلاق: يُسدّ ما أحدثه الحبر داخل الورقة · فتح: تُقطع جسورٌ رفيعةٌ إلى بقع السجّاد */
    mask = morph(morph(mask, w, h, r, true), w, h, r, false);
    mask = morph(morph(mask, w, h, 1, false), w, h, 1, true);
    const found = bestComponent(s, mask, t);
    if (found && found.score > bestScore) {
      bestScore = found.score;
      best = found.region;
    }
  }
  if (!best) return null;
  const up = (p: Point) => ({
    x: Math.min(src.width, Math.max(0, p.x / s.scale)),
    y: Math.min(src.height, Math.max(0, p.y / s.scale)),
  });
  return { ...best, quad: [up(best.quad[0]), up(best.quad[1]), up(best.quad[2]), up(best.quad[3])] };
}

/** أفضلُ رقعةٍ في القناع تشبه ورقة — بإحداثيّات الصورة المصغّرة. */
function bestComponent(s: Small, mask: Uint8Array, threshold: number): { region: RegionQuad; score: number } | null {
  const { w, h } = s;
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const area = w * h;
  let next = 0;
  let best: RegionQuad | null = null;
  let bestScore = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    label[start] = next;
    const rowMin = new Int32Array(h).fill(-1);
    const rowMax = new Int32Array(h).fill(-1);
    let minX = w, maxX = 0, minY = h, maxY = 0;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % w;
      const y = (p / w) | 0;
      if (rowMin[y] < 0 || x < rowMin[y]) rowMin[y] = x;
      if (x > rowMax[y]) rowMax[y] = x;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[top++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[top++] = p + 1; }
      if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = next; stack[top++] = p - w; }
      if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = next; stack[top++] = p + w; }
    }
    if (size < area * 0.02) continue;
    let touches = 0;
    if (minX === 0) touches++;
    if (minY === 0) touches++;
    if (maxX === w - 1) touches++;
    if (maxY === h - 1) touches++;
    /*
      رقعةٌ تلمس طرفين للصورة قطعةٌ من الخلفيّة (خطٌّ رماديّ في السجّاد يدخل من زاوية) لا
      ورقة: من يصوّر فاتورةً يضعها كلَّها في الإطار. وطرفٌ واحد يُحتمل ويُنقص الثقة.
    */
    if (touches >= 2) continue;

    const edgePts: Point[] = [];
    for (let y = 0; y < h; y++) {
      if (rowMin[y] < 0) continue;
      edgePts.push({ x: rowMin[y], y: y + 0.5 }, { x: rowMax[y] + 1, y: y + 0.5 });
    }
    const q = largestInscribedQuad(convexHull(edgePts));
    if (!q || !isConvexQuad(q)) continue;
    const qa = quadArea(q);
    const fill = Math.min(1, size / qa);
    /* الورقةُ تملأ رباعيَّها — بقعةُ السجّاد المتعرّجة لا */
    if (fill < MIN_FILL) continue;
    /* وتبين على ما حولها: ورقيّةُ داخلها فوق ورقيّة حلقةٍ خارجها */
    const contrast = ringContrast(s, q);
    if (contrast < 15) continue;
    /* الورقةُ أنصعُ ما في الصورة: كلّما علت ورقيّةُ داخلها نحو أنصعِ الصورة رجحت */
    const bright = brightness(s, q);
    const score = (qa / area) * Math.pow(fill, 6) * Math.min(1, contrast / 40) * bright * bright * (touches ? 0.6 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = { quad: q, fill, areaRatio: qa / area, contrast, threshold };
    }
  }
  return best ? { region: best, score: bestScore } : null;
}

/** الورقةُ تملأ رباعيَّها الأكبر داخل غلافها — دونها رقعةٌ متعرّجة */
const MIN_FILL = 0.86;

/** موضعُ ورقيّة داخل الرباعيّ (متوسّطُها) بين وسيط الصورة وأنصعها — ٠ إلى ١. */
function brightness(s: Small, q: Quad): number {
  const { w, paper } = s;
  let sum = 0, n = 0;
  const minX = Math.max(0, Math.floor(Math.min(...q.map((p) => p.x))));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...q.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...q.map((p) => p.y))));
  const maxY = Math.min(s.h - 1, Math.ceil(Math.max(...q.map((p) => p.y))));
  for (let y = minY; y <= maxY; y += 2) for (let x = minX; x <= maxX; x += 2) {
    let inside = true;
    for (let i = 0; i < 4 && inside; i++) if (cross(q[i], q[(i + 1) % 4], { x, y }) < 0) inside = false;
    if (inside) { sum += paper[y * w + x]; n++; }
  }
  if (n === 0 || s.hi <= s.lo) return 0;
  return Math.max(0, Math.min(1, (sum / n - s.lo) / (s.hi - s.lo)));
}

/** متوسّطُ الورقيّة داخل الرباعيّ ناقصاً متوسّطها في حلقةٍ حوله. */
function ringContrast(s: Small, q: Quad): number {
  const { w, h, paper } = s;
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  const at = (i: number, k: number) => ({ x: c.x + (q[i].x - c.x) * k, y: c.y + (q[i].y - c.y) * k });
  const scaleQ = (k: number): Quad => [at(0, k), at(1, k), at(2, k), at(3, k)];
  const inner = scaleQ(0.85);
  const outer = scaleQ(1.18);
  const inQuad = (qq: Quad, x: number, y: number) => {
    for (let i = 0; i < 4; i++) if (cross(qq[i], qq[(i + 1) % 4], { x, y }) < 0) return false;
    return true;
  };
  let sIn = 0, nIn = 0, sOut = 0, nOut = 0;
  const minX = Math.max(0, Math.floor(Math.min(...outer.map((p) => p.x))));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...outer.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...outer.map((p) => p.y))));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...outer.map((p) => p.y))));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    if (inQuad(inner, x, y)) { sIn += paper[y * w + x]; nIn++; }
    else if (inQuad(outer, x, y) && !inQuad(q, x, y)) { sOut += paper[y * w + x]; nOut++; }
  }
  if (nIn === 0 || nOut === 0) return 0;
  return sIn / nIn - sOut / nOut;
}
