/**
 * أين الورقة في الصورة؟ — اكتشافٌ خفيف بلا مكتبة رؤية.
 *
 * الفاتورةُ الورقيّة أفتحُ ممّا تحتها (كاونتر · صينيّة · يد). فتُصغَّر الصورة،
 * ويُفصل الفاتحُ عن الداكن بعتبة «أوتسو»، وتُؤخذ أكبرُ رقعةٍ فاتحةٍ متّصلة،
 * وزواياها أقصى نقاطها قطريّاً. وما لا يشبه ورقةً (رقعةٌ صغيرة، أو لا تملأ
 * رباعيّها، أو تملأ الصورة كلَّها) يُرجع `null` — فيبدأ الباريستا من الصورة
 * كلّها ويسحب الزوايا بيده. الاكتشافُ عونٌ لا حكم.
 *
 * خالصةٌ — لا متصفّح.
 */
import { isConvexQuad, quadArea, type Quad, type Raster } from "./geometry";
import { plausibleBorder, quadFromEdges } from "./edges";

/** أطولُ ضلعٍ للصورة المصغّرة — يكفي للحواف ويجري في أجزاءٍ من الثانية. */
export const DETECT_SIDE = 360;

/** الورقةُ أصغرُ من هذا من الصورة: بعيدةٌ أو ليست ورقة. */
const MIN_AREA_RATIO = 0.12;
/** وأكبرُ من هذا: تملأ الصورة (أو الخلفيّةُ نفسُها فاتحة) — لا حواف تُكتشف. */
const MAX_AREA_RATIO = 0.97;
/** الرقعةُ تملأ رباعيّها: الورقةُ مستطيل، والظلُّ والضوءُ المتناثر لا. */
const MIN_FILL = 0.72;
/** كم تُشدّ الزوايا نحو الوسط — نسبةٌ من بُعدها عنه */
const EDGE_INSET = 0.012;

/** عتبةُ أوتسو: القيمة التي تفصل الفاتح عن الداكن بأكبر تباينٍ بين الفئتين. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

/** صورةٌ رماديّةٌ مصغّرة بمتوسّط كلّ مربّع — لا بأخذ بكسلٍ واحد منه، فلا يضيع الخطّ الرفيع. */
export function downscaleGray(src: Raster, maxSide: number): { gray: Uint8Array; width: number; height: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const sums = new Float64Array(width * height);
  const counts = new Uint32Array(width * height);
  const d = src.data;
  for (let y = 0; y < src.height; y++) {
    const ty = Math.min(height - 1, (y * scale) | 0);
    for (let x = 0; x < src.width; x++) {
      const tx = Math.min(width - 1, (x * scale) | 0);
      const i = (y * src.width + x) * 4;
      const t = ty * width + tx;
      sums[t] += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      counts[t]++;
    }
  }
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = counts[i] ? Math.round(sums[i] / counts[i]) : 0;
  return { gray, width, height, scale };
}

/** أطولُ ضلعٍ لصورة الخطوط — أدقّ من صورة اللون، وهَف يجري فيها بأجزاءٍ من الثانية */
export const EDGE_SIDE = 480;

/**
 * زوايا الورقة بإحداثيّات الصورة الأصل — أو `null` إن لم تُعرف بثقة.
 *
 * الخطوطُ أوّلاً (`edges.ts`): تصدق على كلّ خلفيّة. ثمّ اللونُ إن لم تجد خطوطاً
 * (ورقٌ مجعّد بلا طرفٍ مستقيم على كاونترٍ داكن).
 */
export function detectDocument(src: Raster): Quad | null {
  const small = downscaleGray(src, EDGE_SIDE);
  const found = quadFromEdges(small);
  if (found) {
    const up = (p: { x: number; y: number }) => ({
      x: Math.min(src.width, Math.max(0, p.x / small.scale)),
      y: Math.min(src.height, Math.max(0, p.y / small.scale)),
    });
    const q = found.quad;
    /* كما في اللون: شدٌّ يسير نحو الوسط فلا يبقى خطُّ الخلفيّة على طرف الورقة */
    const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
    const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
    const pull = (p: { x: number; y: number }) => up({ x: p.x + (cx - p.x) * EDGE_INSET * 0.6, y: p.y + (cy - p.y) * EDGE_INSET * 0.6 });
    return [pull(q[0]), pull(q[1]), pull(q[2]), pull(q[3])];
  }
  const byColor = detectByBrightness(src);
  if (!byColor) return null;
  const down = byColor.map((p) => ({ x: p.x * small.scale, y: p.y * small.scale }));
  return plausibleBorder(small, [down[0], down[1], down[2], down[3]]) ? byColor : null;
}

/** فصلُ الفاتح عن الداكن — للورقة على سطحٍ داكن حين لا تُرى خطوطُها. */
export function detectByBrightness(src: Raster): Quad | null {
  const { gray, width, height, scale } = downscaleGray(src, DETECT_SIDE);
  const t = otsuThreshold(gray);
  const bright = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bright[i] = gray[i] > t ? 1 : 0;

  /* أكبرُ رقعةٍ فاتحةٍ متّصلة — بمكدّسٍ لا بالاستدعاء الذاتيّ، فلا يفيض */
  const label = new Int32Array(gray.length);
  const stack = new Int32Array(gray.length);
  let bestLabel = 0;
  let bestSize = 0;
  let next = 0;
  for (let start = 0; start < gray.length; start++) {
    if (!bright[start] || label[start]) continue;
    next++;
    let top = 0;
    let size = 0;
    stack[top++] = start;
    label[start] = next;
    while (top > 0) {
      const p = stack[--top];
      size++;
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0 && bright[p - 1] && !label[p - 1]) { label[p - 1] = next; stack[top++] = p - 1; }
      if (x < width - 1 && bright[p + 1] && !label[p + 1]) { label[p + 1] = next; stack[top++] = p + 1; }
      if (y > 0 && bright[p - width] && !label[p - width]) { label[p - width] = next; stack[top++] = p - width; }
      if (y < height - 1 && bright[p + width] && !label[p + width]) { label[p + width] = next; stack[top++] = p + width; }
    }
    if (size > bestSize) { bestSize = size; bestLabel = next; }
  }
  if (bestLabel === 0) return null;

  /* الزوايا: أقصى نقاط الرقعة على القطرين */
  let tl = { x: 0, y: 0, v: Infinity };
  let br = { x: 0, y: 0, v: -Infinity };
  let tr = { x: 0, y: 0, v: -Infinity };
  let bl = { x: 0, y: 0, v: Infinity };
  for (let p = 0; p < label.length; p++) {
    if (label[p] !== bestLabel) continue;
    const x = p % width;
    const y = (p / width) | 0;
    const s = x + y;
    const d = x - y;
    if (s < tl.v) tl = { x, y, v: s };
    if (s > br.v) br = { x, y, v: s };
    if (d > tr.v) tr = { x, y, v: d };
    if (d < bl.v) bl = { x, y, v: d };
  }
  const small: Quad = [
    { x: tl.x, y: tl.y }, { x: tr.x + 1, y: tr.y }, { x: br.x + 1, y: br.y + 1 }, { x: bl.x, y: bl.y + 1 },
  ];
  if (!isConvexQuad(small)) return null;
  const area = quadArea(small);
  const ratio = area / (width * height);
  if (ratio < MIN_AREA_RATIO || ratio > MAX_AREA_RATIO) return null;
  if (bestSize / area < MIN_FILL) return null;

  /*
    الزوايا تُشدّ نحو الوسط قليلاً: حدُّ الرقعة في الصورة المصغّرة يأخذ بكسلاً أو
    اثنين من الكاونتر، فيبقى على الورقة الممسوحة خطٌّ داكن في طرفها.
  */
  const cx = (small[0].x + small[1].x + small[2].x + small[3].x) / 4;
  const cy = (small[0].y + small[1].y + small[2].y + small[3].y) / 4;
  const up = (p: { x: number; y: number }) => ({
    x: Math.min(src.width, Math.max(0, (p.x + (cx - p.x) * EDGE_INSET) / scale)),
    y: Math.min(src.height, Math.max(0, (p.y + (cy - p.y) * EDGE_INSET) / scale)),
  });
  return [up(small[0]), up(small[1]), up(small[2]), up(small[3])];
}
