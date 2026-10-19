/**
 * حوافُّ الورقة من خطوطها لا من لونها — كما تفعل الماسحات.
 *
 * فصلُ الفاتح عن الداكن (`detect.ts`) يفشل حين يكون ما تحت الورقة فاتحاً
 * (كاونترٌ أبيض، رخام، ورقةٌ فوق ورقة) أو حين تملأ الورقةُ الصورةَ تقريباً — وهي
 * حالُ أكثر الصور الحقيقيّة. وما يبقى في كلّ حال: طرفُ الورقة خطٌّ مستقيم حادّ.
 *
 *   ١. تُصغَّر وتُنعَّم، ويُحسب اتّجاهُ التدرّج وشدّتُه (سوبل)، وتُرقَّق الحوافّ.
 *   ٢. كلُّ بكسل حافّةٍ يصوّت لخطوطٍ قريبةٍ من اتّجاهه (تحويل هَف).
 *   ٣. تُؤخذ أقوى الخطوط الأفقيّة والعموديّة، ويُجرَّب كلُّ رباعيٍّ منها:
 *      محدَّب، كبير، زواياه معقولة، وأضلاعُه الأربعة **تقع فعلاً على حوافّ**.
 *   ٤. الفائزُ أكبرُها مساحةً بين ما تصدق أضلاعُه — فجدولُ الفاتورة داخلها
 *      (خطوطٌ صادقةٌ أيضاً) لا يغلب طرفَها.
 *
 * خالصةٌ — لا متصفّح.
 */
import { isConvexQuad, orderQuad, quadArea, type Point, type Quad } from "./geometry";

export interface GrayImage { gray: Uint8Array; width: number; height: number }

interface Line { theta: number; rho: number; votes: number }

const THETA_STEPS = 180;
/** كم خطّاً يُرشَّح لكلّ ضلع — من أطراف الصورة نحو وسطها */
const CANDIDATES = 7;
/** نسبةُ الحوافّ وراء الضلع التي تجعله سطراً داخل الفاتورة لا طرفَها */
const MAX_INK_BEYOND = 0.18;
const COS = Float64Array.from({ length: THETA_STEPS }, (_, t) => Math.cos((t * Math.PI) / THETA_STEPS));
const SIN = Float64Array.from({ length: THETA_STEPS }, (_, t) => Math.sin((t * Math.PI) / THETA_STEPS));

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** حوافٌّ رفيعة واتّجاهُها: شدّةٌ فوق عتبةٍ تكيّفيّة، وكبتُ ما ليس قمّةً على اتّجاهه. */
export function edgeMap(img: GrayImage): { edge: Uint8Array; angle: Float32Array; count: number } {
  const { width: w, height: h } = img;
  const raw = new Float32Array(img.gray.length);
  for (let i = 0; i < raw.length; i++) raw[i] = img.gray[i];
  const f = boxBlur(boxBlur(raw, w, h, 1), w, h, 1);

  const mag = new Float32Array(f.length);
  const angle = new Float32Array(f.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = f[i - w + 1] + 2 * f[i + 1] + f[i + w + 1] - f[i - w - 1] - 2 * f[i - 1] - f[i + w - 1];
      const gy = f[i + w - 1] + 2 * f[i + w] + f[i + w + 1] - f[i - w - 1] - 2 * f[i - w] - f[i - w + 1];
      mag[i] = Math.hypot(gx, gy);
      angle[i] = Math.atan2(gy, gx);
    }
  }

  /*
    العتبةُ من مستوى الضجيج لا من أقوى الحوافّ: حبرُ النصّ (أسودُ على أبيض) أقوى بكثيرٍ
    من طرف ورقةٍ بيضاء على كاونترٍ فاتح، فعتبةٌ نسبيّةٌ لأقوى الحوافّ تُسقط الطرفَ نفسَه
    (وُجد: صفرُ خطوطٍ عموديّة). فثلاثةُ أضعاف الوسيط — والوسيطُ ضجيجُ السطوح الملساء.
  */
  const sorted = Float32Array.from(mag).sort();
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const threshold = Math.min(Math.max(24, median * 3), sorted[Math.floor(sorted.length * 0.9)]);

  const edge = new Uint8Array(f.length);
  let count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < threshold) continue;
      /* كبتُ غير القمّة: الجاران على اتّجاه التدرّج أضعف */
      const a = angle[i];
      const dx = Math.round(Math.cos(a));
      const dy = Math.round(Math.sin(a));
      if (m < mag[i + dy * w + dx] || m < mag[i - dy * w - dx]) continue;
      edge[i] = 1;
      count++;
    }
  }
  return { edge, angle, count };
}

/** خطوطٌ بتحويل هَف — كلُّ بكسلٍ يصوّت لما قارب عموديَّه على اتّجاه تدرّجه. */
export function houghLines(edge: Uint8Array, angle: Float32Array, w: number, h: number, max = 24): Line[] {
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoBins = 2 * diag + 1;
  const acc = new Int32Array(rhoBins * THETA_STEPS);
  const spread = 12;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!edge[i]) continue;
      const t0 = Math.round(((angle[i] < 0 ? angle[i] + Math.PI : angle[i]) * THETA_STEPS) / Math.PI);
      for (let dt = -spread; dt <= spread; dt++) {
        const t = (((t0 + dt) % THETA_STEPS) + THETA_STEPS) % THETA_STEPS;
        const rho = Math.round(x * COS[t] + y * SIN[t]) + diag;
        acc[rho * THETA_STEPS + t]++;
      }
    }
  }

  const minVotes = Math.max(15, Math.round(Math.min(w, h) * 0.12));
  const peaks: Line[] = [];
  const R = 6;
  const T = 4;
  for (let r = 0; r < rhoBins; r++) {
    for (let t = 0; t < THETA_STEPS; t++) {
      const v = acc[r * THETA_STEPS + t];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dr = -R; dr <= R && isMax; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rhoBins) continue;
        for (let dt = -T; dt <= T; dt++) {
          if (dr === 0 && dt === 0) continue;
          const tt = (((t + dt) % THETA_STEPS) + THETA_STEPS) % THETA_STEPS;
          /* حول الصفر يلتفّ الاتّجاه فيُعكس البعد */
          const rr2 = t + dt < 0 || t + dt >= THETA_STEPS ? 2 * diag - rr : rr;
          if (rr2 < 0 || rr2 >= rhoBins) continue;
          const o = acc[rr2 * THETA_STEPS + tt];
          if (o > v || (o === v && (dr < 0 || (dr === 0 && dt < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) peaks.push({ theta: (t * Math.PI) / THETA_STEPS, rho: r - diag, votes: v });
    }
  }
  return peaks.sort((a, b) => b.votes - a.votes).slice(0, max);
}

/** جوارُ الحافّة (تمدّدٌ ببكسلين) — الضلعُ المستقيم يمرّ بقرب حافّةٍ متعرّجةٍ قليلاً */
function dilate(edge: Uint8Array, w: number, h: number): Uint8Array {
  const near = new Uint8Array(edge.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edge[y * w + x]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) near[yy * w + xx] = 1;
        }
      }
    }
  }
  return near;
}

function intersect(a: Line, b: Line): Point | null {
  const det = Math.cos(a.theta) * Math.sin(b.theta) - Math.sin(a.theta) * Math.cos(b.theta);
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (a.rho * Math.sin(b.theta) - b.rho * Math.sin(a.theta)) / det,
    y: (b.rho * Math.cos(a.theta) - a.rho * Math.cos(b.theta)) / det,
  };
}

/** كم من الضلع يقع على حافّة — نقطةٌ كلَّ بكسل، والحافّةُ في جوارٍ من بكسلين. */
function sideSupport(near: Uint8Array, w: number, h: number, a: Point, b: Point): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.round(len));
  let hit = 0;
  let inside = 0;
  for (let k = 0; k <= n; k++) {
    const x = Math.round(a.x + ((b.x - a.x) * k) / n);
    const y = Math.round(a.y + ((b.y - a.y) * k) / n);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    inside++;
    if (near[y * w + x]) hit++;
  }
  /* ضلعٌ أكثرُه خارج الصورة لا يُصدَّق — ولا يُكذَّب — فيُعدّ ضعيفاً */
  return inside < n * 0.6 ? 0 : hit / inside;
}

/**
 * كم من الحبر خارج الضلع — شريطٌ بعرض بضعة بكسلات وراءه، بعيداً عن الوسط.
 *
 * وراءَ طرف الورقة الحقيقيّ كاونترٌ أملس، ووراءَ سطرٍ داخل الفاتورة (حدُّ الجدول، سطرُ
 * العنوان) نصٌّ وشعار. فإن كان وراءَ الضلع حبرٌ فليس طرفاً: قصٌّ عليه يقطع المورّدَ
 * ورمزَ الفاتورة، وهو أسوأ من صورةٍ بلا قصّ.
 */
function inkBeyond(edge: Uint8Array, w: number, h: number, a: Point, b: Point, center: Point, near: number, far: number): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return 0;
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (nx * (center.x - mid.x) + ny * (center.y - mid.y) > 0) { nx = -nx; ny = -ny; }
  let ink = 0;
  let seen = 0;
  const steps = Math.max(8, Math.round(len / 2));
  /* يُترك عُشرُ الضلع من طرفيه — الزوايا يلتقي فيها ضلعان */
  for (let k = Math.round(steps * 0.1); k <= Math.round(steps * 0.9); k++) {
    const px = a.x + ((b.x - a.x) * k) / steps;
    const py = a.y + ((b.y - a.y) * k) / steps;
    for (let d = near; d <= far; d += 2) {
      const x = Math.round(px + nx * d);
      const y = Math.round(py + ny * d);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      seen++;
      if (edge[y * w + x]) ink++;
    }
  }
  return seen === 0 ? 0 : ink / seen;
}

function cornerAngleOk(q: Quad): boolean {
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const a = q[(i + 3) % 4];
    const b = q[(i + 1) % 4];
    const v1 = { x: a.x - p.x, y: a.y - p.y };
    const v2 = { x: b.x - p.x, y: b.y - p.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    if (deg < 50 || deg > 130) return false;
  }
  return true;
}

export interface EdgeQuad { quad: Quad; support: number; areaRatio: number }

/**
 * أفضلُ رباعيٍّ تقع أضلاعُه على حوافّ — بإحداثيّات الصورة المعطاة، أو `null`.
 */
export function quadFromEdges(img: GrayImage): EdgeQuad | null {
  const { width: w, height: h } = img;
  const { edge, angle, count } = edgeMap(img);
  if (count < 50) return null;

  const near = dilate(edge, w, h);

  /*
    أسطرُ النصّ داخل الفاتورة خطوطٌ أفقيّةٌ قويّةٌ بالعشرات، تزاحم طرفَ الورقة في رأس
    القائمة (وُجد: الطرفُ السفليّ في المرتبة ٢٨). والطرفُ **أبعدُ** الخطوط لا أقواها:
    فالأعلى يُرشَّح من أعلى الخطوط موضعاً، والأسفلُ من أسفلها، وكذا اليمين واليسار —
    وأسطرُ النصّ في الوسط لا تدخل مهما كثرت. والمساحةُ وصدقُ الأضلاع يحسمان بين المرشّحين.
  */
  const lines = houghLines(edge, angle, w, h, 160);
  const isHorizontal = (l: Line) => l.theta > Math.PI / 4 && l.theta < (3 * Math.PI) / 4;
  /* موضعُ الخطّ عند منتصف الصورة: الأفقيّ بارتفاعه، والعموديّ بعرضه */
  const yAtCenter = (l: Line) => (l.rho - (w / 2) * Math.cos(l.theta)) / Math.sin(l.theta);
  const xAtCenter = (l: Line) => (l.rho - (h / 2) * Math.sin(l.theta)) / Math.cos(l.theta);
  const horizontal = lines.filter(isHorizontal).sort((a, b) => yAtCenter(a) - yAtCenter(b));
  const vertical = lines.filter((l) => !isHorizontal(l)).sort((a, b) => xAtCenter(a) - xAtCenter(b));
  if (horizontal.length < 2 || vertical.length < 2) return null;
  const tops = horizontal.slice(0, CANDIDATES);
  const bottoms = horizontal.slice(-CANDIDATES);
  const lefts = vertical.slice(0, CANDIDATES);
  const rights = vertical.slice(-CANDIDATES);

  const area = w * h;
  const margin = 0.08;
  let best: EdgeQuad | null = null;
  let bestScore = 0;
  for (const top of tops) {
    for (const bottom of bottoms) {
      if (top === bottom) continue;
      for (const left of lefts) {
        for (const right of rights) {
          if (left === right) continue;
          const pts = [intersect(top, left), intersect(top, right), intersect(bottom, left), intersect(bottom, right)];
          if (pts.some((p) => !p || p.x < -w * margin || p.x > w * (1 + margin) || p.y < -h * margin || p.y > h * (1 + margin))) continue;
          const q = orderQuad(pts as Point[]);
          if (!isConvexQuad(q) || !cornerAngleOk(q)) continue;
          const ratio = quadArea(q) / area;
          if (ratio < 0.15 || ratio > 1.05) continue;
          const sides = [0, 1, 2, 3].map((i) => sideSupport(near, w, h, q[i], q[(i + 1) % 4]));
          const minSide = Math.min(...sides);
          const mean = sides.reduce((s, v) => s + v, 0) / 4;
          /* ضلعٌ قد تحجبه يدٌ أو ظلّ — لكن لا يُقبل رباعيٌّ ضلعٌ منه بلا حافّة */
          if (minSide < 0.3 || mean < 0.55) continue;
          /* وراءَ الطرف لا حبر — وما وراءه نصٌّ سطرٌ داخل الفاتورة لا طرفُها */
          const center = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
          const band = Math.max(4, Math.round(Math.min(w, h) * 0.012));
          const beyond = Math.max(...[0, 1, 2, 3].map((i) => inkBeyond(near, w, h, q[i], q[(i + 1) % 4], center, band, band * 7)));
          if (beyond > MAX_INK_BEYOND) continue;
          const score = ratio * mean * mean * (1 - beyond * 3);
          if (score > bestScore) {
            bestScore = score;
            best = { quad: q, support: mean, areaRatio: ratio };
          }
        }
      }
    }
  }
  return best;
}

/**
 * أيصدق هذا الرباعيّ طرفاً للورقة؟ — لما وجده بابٌ آخر (فصلُ اللون): أضلاعُه على حوافّ،
 * ولا حبرَ وراءها. وإلّا فالصورةُ كلُّها خيرٌ من قصٍّ يقطع المورّد.
 */
export function plausibleBorder(img: GrayImage, q: Quad): boolean {
  const { width: w, height: h } = img;
  const { edge } = edgeMap(img);
  const near = dilate(edge, w, h);
  const sides = [0, 1, 2, 3].map((i) => sideSupport(near, w, h, q[i], q[(i + 1) % 4]));
  if (sides.reduce((s, v) => s + v, 0) / 4 < 0.45) return false;
  const center = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  const band = Math.max(4, Math.round(Math.min(w, h) * 0.012));
  return Math.max(...[0, 1, 2, 3].map((i) => inkBeyond(near, w, h, q[i], q[(i + 1) % 4], center, band, band * 7))) <= MAX_INK_BEYOND;
}
