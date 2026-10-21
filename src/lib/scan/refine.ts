/**
 * تدقيقُ أضلاع الورقة بعد أن عُرف موضعُها تقريباً.
 *
 * الرقعةُ البيضاء (`region.ts`) تُعرف بصورةٍ مصغّرة وتُسدّ ثقوبُها، فتقع زواياها على
 * بُعد بضعة بكسلات من الحقّ. وطرفُ الورقة الحقيقيّ قفزةٌ حادّة في السطوع. فلكلّ ضلع:
 * نقاطٌ على طوله، ولكلّ نقطةٍ يُبحث على العموديّ في شريطٍ ضيّق عن أشدّ قفزةٍ من الفاتح
 * (الداخل) إلى ما حوله، ثمّ يُطابَق خطٌّ مستقيمٌ على النقاط مع طرح الشاذّ منها (إصبعٌ،
 * ظلّ). والزوايا تقاطعُ الخطوط الأربعة. وما لم يُطابَق بثقةٍ يبقى على تقديره الأوّل.
 *
 * خالصةٌ — لا متصفّح.
 */
import type { GrayImage } from "./edges";
import { isConvexQuad, type Point, type Quad } from "./geometry";

interface FitLine { p: Point; d: Point }

function at(img: GrayImage, x: number, y: number): number {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  return img.gray[yi * img.width + xi];
}

/** خطٌّ بأقلّ المربّعات المتعامدة على نقاط (المحورُ الرئيس لتغايرها). */
function fit(points: Point[]): FitLine | null {
  if (points.length < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const my = points.reduce((s, p) => s + p.y, 0) / points.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } };
}

const distTo = (l: FitLine, q: Point) => Math.abs((q.x - l.p.x) * l.d.y - (q.y - l.p.y) * l.d.x);

function intersect(a: FitLine, b: FitLine): Point | null {
  const det = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / det;
  return { x: a.p.x + a.d.x * t, y: a.p.y + a.d.y * t };
}

/**
 * يدقّق رباعيّاً تقريبيّاً على صورةٍ رماديّة (بإحداثيّاتها) — ويُرجع الأصلَ إن لم يثق.
 */
export function refineQuad(img: GrayImage, q: Quad): Quad {
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  const band = Math.max(4, Math.round(Math.hypot(img.width, img.height) * 0.025));
  const lines: (FitLine | null)[] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 10) { lines.push(null); continue; }
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    /* العموديّ نحو الخارج */
    let nx = -ty, ny = tx;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (nx * (c.x - mid.x) + ny * (c.y - mid.y) > 0) { nx = -nx; ny = -ny; }

    const samples = Math.min(60, Math.max(12, Math.round(len / 6)));
    const pts: Point[] = [];
    for (let k = 1; k < samples; k++) {
      /* يُترك عُشرٌ من كلّ طرف: الزاويةُ قد تكون مقصوصةً أو مطويّة */
      const f = 0.1 + (0.8 * k) / samples;
      const px = a.x + (b.x - a.x) * f;
      const py = a.y + (b.y - a.y) * f;
      /*
        القفزةُ من الورق (أفتح) إلى ما وراءه. والطرفُ **أبعدُ** قفزةٍ قويّة لا أشدُّها:
        سطرٌ أسود قرب الطرف قفزتُه من الأبيض أشدّ من قفزة الورق إلى الكاونتر (وُجد:
        انجذب الضلعُ إلى أوّل سطر نصّ). فيُؤخذ أبعدُ موضعٍ قفزتُه نصفُ أشدِّها على الأقلّ.
      */
      const steps: number[] = [];
      let maxStep = 0;
      for (let d = -band; d <= band; d++) {
        const inside = at(img, px + nx * (d - 2), py + ny * (d - 2));
        const outside = at(img, px + nx * (d + 2), py + ny * (d + 2));
        const step = inside - outside;
        steps.push(step);
        if (step > maxStep) maxStep = step;
      }
      if (maxStep < MIN_STEP) continue;
      const floor = Math.max(MIN_STEP, maxStep * 0.5);
      let bestD = 0;
      let found = false;
      for (let j = steps.length - 1; j >= 0; j--) {
        if (steps[j] < floor) continue;
        /* قمّةُ هذه القفزة: تُتبَع نحو الداخل ما دامت تشتدّ */
        let k = j;
        while (k > 0 && steps[k - 1] >= steps[k]) k--;
        bestD = k - band;
        found = true;
        break;
      }
      if (found) pts.push({ x: px + nx * bestD, y: py + ny * bestD });
    }
    if (pts.length < samples * 0.4) { lines.push(null); continue; }
    /* طرحُ الشاذّ مرّتين: إصبعٌ أو ظلٌّ يجذب نقاطاً بعيدة عن الخطّ */
    let kept = pts;
    let line = fit(kept);
    for (let round = 0; round < 2 && line; round++) {
      const ds = kept.map((p) => distTo(line!, p)).sort((x, y) => x - y);
      const limit = Math.max(1.5, ds[Math.floor(ds.length * 0.7)] * 1.5);
      kept = kept.filter((p) => distTo(line!, p) <= limit);
      line = kept.length >= 4 ? fit(kept) : null;
    }
    lines.push(line && kept.length >= samples * 0.3 ? line : null);
  }

  /* ضلعٌ لم يُطابَق يبقى على تقديره: خطُّه من زاويتيه الأوليين */
  const sideLine = (i: number): FitLine => {
    const fitted = lines[i];
    if (fitted) return fitted;
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
  };
  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    /* الزاويةُ i بين الضلع السابق (i-1) والضلع i */
    const p = intersect(sideLine((i + 3) % 4), sideLine(i));
    if (!p) return q;
    corners.push(p);
  }
  const out: Quad = [corners[0], corners[1], corners[2], corners[3]];
  /* ولا يُقبل تدقيقٌ أبعدَ الزاويةَ أكثرَ من الشريط — ذلك خطأ مطابقةٍ لا تدقيق */
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(out[i].x - q[i].x, out[i].y - q[i].y) > band * 2.5) return q;
  }
  return isConvexQuad(out) ? out : q;
}

/** أدنى قفزةٍ في السطوع تُعدّ طرفاً */
const MIN_STEP = 12;
