import { describe, expect, it } from "vitest";
import { applyHomography, homography, insetQuad, isConvexQuad, orderQuad, outputSize, warpQuad, type Point, type Quad, type Raster } from "./geometry";
import { detectDocument, otsuThreshold } from "./detect";
import { enhanceScan } from "./enhance";
import { assessQuality } from "./quality";

/** صورةٌ اصطناعيّة: كاونترٌ داكن، وعليه ورقةٌ مائلة فيها أسطرُ «نصّ». */
function photo(width: number, height: number, paper: Quad, opts: { light?: (x: number, y: number) => number } = {}): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  const inside = (p: Point) => {
    for (let i = 0; i < 4; i++) {
      const a = paper[i];
      const b = paper[(i + 1) % 4];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return false;
    }
    return true;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 55;
      if (inside({ x, y })) {
        /* أسطرُ نصّ: شريطٌ داكن كلّ ١٢ بكسلاً، مقطّعٌ كالكلمات */
        const text = y % 12 < 3 && x % 9 < 6 && y > paper[0].y + 20 && y < paper[2].y - 20;
        v = text ? 30 : 235;
      }
      const k = opts.light ? opts.light(x, y) : 1;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(v * k);
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function boxBlur(src: Raster, r: number): Raster {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = Math.min(height - 1, Math.max(0, y + dy));
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          s += data[(yy * width + xx) * 4];
          n++;
        }
      }
      const i = (y * width + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = s / n;
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/* ورقةٌ مائلة قليلاً، في وسط الصورة — بترتيب عقارب الساعة على الشاشة */
const PAPER: Quad = [{ x: 70, y: 40 }, { x: 330, y: 60 }, { x: 320, y: 470 }, { x: 55, y: 455 }];

describe("الهندسة", () => {
  it("يرتّب الزوايا كيفما جاءت", () => {
    const shuffled = [PAPER[2], PAPER[0], PAPER[3], PAPER[1]];
    expect(orderQuad(shuffled)).toEqual(PAPER);
  });

  it("التحويلُ المنظوريّ يأخذ كلّ زاويةٍ إلى نظيرتها", () => {
    const rect: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 150 }, { x: 0, y: 150 }];
    const h = homography(rect, PAPER);
    rect.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(PAPER[i].x, 6);
      expect(q.y).toBeCloseTo(PAPER[i].y, 6);
    });
  });

  it("المقاسُ من أطول الضلعين، ويُصغَّر إلى الحدّ", () => {
    const s = outputSize(PAPER, 200);
    expect(Math.max(s.width, s.height)).toBe(200);
    expect(s.height).toBeGreaterThan(s.width);
  });

  it("يرفض الرباعيّ المتقاطع", () => {
    expect(isConvexQuad(PAPER)).toBe(true);
    expect(isConvexQuad([PAPER[0], PAPER[2], PAPER[1], PAPER[3]])).toBe(false);
  });

  it("تقويمُ الصورة كلّها بلا ميلٍ يعيدها كما هي", () => {
    const img = photo(60, 40, insetQuad(60, 40, 0.1));
    const out = warpQuad(img, [{ x: 0, y: 0 }, { x: 59, y: 0 }, { x: 59, y: 39 }, { x: 0, y: 39 }], 1000);
    expect(out.width).toBe(59);
    let diff = 0;
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
      diff += Math.abs(out.data[(y * out.width + x) * 4] - img.data[(y * img.width + x) * 4]);
    }
    expect(diff / (out.width * out.height)).toBeLessThan(8);
  });
});

describe("اكتشافُ الورقة", () => {
  it("عتبةُ أوتسو بين الداكن والفاتح", () => {
    const g = new Uint8Array(200);
    g.fill(40, 0, 100);
    g.fill(220, 100);
    const t = otsuThreshold(g);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(220);
  });

  it("يجد زوايا الورقة المائلة على الكاونتر", () => {
    const q = detectDocument(photo(400, 520, PAPER));
    expect(q).not.toBeNull();
    q!.forEach((p, i) => {
      /* ٢٪ من ضلع الصورة — كبقيّة الاختبارات (٢٠–٢٥ بكسلاً على ١٢٠٠) */
      expect(Math.abs(p.x - PAPER[i].x)).toBeLessThan(11);
      expect(Math.abs(p.y - PAPER[i].y)).toBeLessThan(11);
    });
  });

  it("لا يخترع ورقةً حين تملأ الصورةَ كلَّها", () => {
    expect(detectDocument(photo(300, 400, [{ x: -5, y: -5 }, { x: 305, y: -5 }, { x: 305, y: 405 }, { x: -5, y: 405 }]))).toBeNull();
  });

  it("ولا حين لا ورقةَ أصلاً", () => {
    expect(detectDocument(photo(300, 400, [{ x: 140, y: 190 }, { x: 160, y: 190 }, { x: 160, y: 210 }, { x: 140, y: 210 }]))).toBeNull();
  });
});

describe("التنظيف", () => {
  it("الورقةُ في الظلّ تصير بيضاء، والحبرُ يبقى داكناً", () => {
    /* ظلٌّ من اليسار إلى اليمين: نصفُ الضوء على طرف الورقة */
    const shaded = photo(300, 400, insetQuad(300, 400, 0), { light: (x) => 0.5 + 0.5 * (x / 300) });
    const out = enhanceScan(shaded, "document");
    const at = (x: number, y: number) => out.data[(y * out.width + x) * 4];
    /* ورقٌ بلا نصّ في الطرفين — المظلَّل والمضاء */
    expect(at(10, 10)).toBeGreaterThan(230);
    expect(at(290, 10)).toBeGreaterThan(230);
    /* وحرفٌ في الطرف المظلَّل ما زال حرفاً */
    expect(at(13, 24)).toBeLessThan(80);
  });
});

describe("لا يُمحى الحبرُ الباهت", () => {
  it("حرفُ الإيصال الحراريّ الباهت يبقى مقروءاً بعد التنظيف", () => {
    /* ورقٌ ٢٣٥ وحبرٌ باهت ١٩٠ (إيصالٌ حراريّ قديم) */
    const img = photo(300, 400, insetQuad(300, 400, 0));
    for (let y = 100; y < 300; y++) for (let x = 50; x < 250; x++) {
      if (y % 12 < 3) { const i = (y * 300 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 190; }
    }
    for (const mode of ["document", "color"] as const) {
      const out = enhanceScan(img, mode);
      const faint = out.data[(108 * 300 + 120) * 4];
      const paper = out.data[(104 * 300 + 120) * 4];
      expect(paper - faint, mode).toBeGreaterThan(45);
      expect(paper, mode).toBeGreaterThan(240);
    }
  });
});

describe("فحصُ الوضوح", () => {
  const sharp = photo(400, 520, insetQuad(400, 520, 0));

  it("الواضحة بلا ملاحظات", () => {
    expect(assessQuality(sharp).issues).toEqual([]);
  });

  it("المهزوزة تُقال", () => {
    expect(assessQuality(boxBlur(sharp, 8)).issues).toContain("BLURRY");
  });

  it("المظلمة تُقال", () => {
    const dark = photo(400, 520, insetQuad(400, 520, 0), { light: () => 0.25 });
    expect(assessQuality(dark).issues).toContain("DARK");
  });

  it("الورقةُ الصغيرة في الصورة تُقال", () => {
    expect(assessQuality(sharp, 0.1).issues).toContain("SMALL");
  });
});

/** صورةٌ أقرب إلى الواقع: خلفيّةٌ بأيّ لون، وضجيج، وإضاءةٌ غير متساوية، وجدولٌ داخل الفاتورة، ويدٌ على طرفها. */
function realistic(opts: {
  width: number; height: number; paper: Quad; bg: number; paperTone: number;
  noise?: number; table?: boolean; hand?: { x: number; y: number; r: number }; light?: (x: number, y: number) => number;
}): Raster {
  const { width, height, paper } = opts;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const inside = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = paper[i];
      const b = paper[(i + 1) % 4];
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false;
    }
    return true;
  };
  const minX = Math.min(...paper.map((p) => p.x)); const maxX = Math.max(...paper.map((p) => p.x));
  const minY = Math.min(...paper.map((p) => p.y)); const maxY = Math.max(...paper.map((p) => p.y));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = opts.bg + Math.sin(x / 9) * 6; // نسيجُ الكاونتر
      if (inside(x, y)) {
        v = opts.paperTone;
        const u = (x - minX) / (maxX - minX);
        const t = (y - minY) / (maxY - minY);
        if (y % 14 < 3 && x % 11 < 7 && t > 0.08 && t < 0.92 && u > 0.08 && u < 0.92) v = 40;
        if (opts.table && t > 0.35 && t < 0.7 && u > 0.1 && u < 0.9 && (Math.abs(t - 0.35) < 0.004 || Math.abs(t - 0.7) < 0.004 || Math.abs(t - 0.5) < 0.003 || Math.abs(u - 0.1) < 0.003 || Math.abs(u - 0.9) < 0.003 || Math.abs(u - 0.5) < 0.003)) v = 30;
      }
      if (opts.hand && Math.hypot(x - opts.hand.x, y - opts.hand.y) < opts.hand.r) v = 150;
      v *= opts.light ? opts.light(x, y) : 1;
      v += ((rnd() - 0.5) * 2) * (opts.noise ?? 0);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.max(0, Math.min(255, Math.round(v)));
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function expectNear(q: Quad | null, truth: Quad, tol: number) {
  expect(q, "لم تُكتشف الورقة").not.toBeNull();
  q!.forEach((p, i) => {
    expect(Math.abs(p.x - truth[i].x), `الزاوية ${i} أفقيّاً`).toBeLessThan(tol);
    expect(Math.abs(p.y - truth[i].y), `الزاوية ${i} رأسيّاً`).toBeLessThan(tol);
  });
}

/* صورٌ كاملة الحجم تُعالَج بكسلاً بكسلاً: ثانيةٌ محلّيّاً، وستٌّ على خادم CI مع قياس التغطية */
describe("اكتشافُ الورقة من خطوطها — حيث يفشل اللون", { timeout: 30_000 }, () => {
  const W = 900;
  const H = 1200;
  const tilted: Quad = [{ x: 140, y: 110 }, { x: 760, y: 150 }, { x: 790, y: 1080 }, { x: 100, y: 1050 }];

  it("ورقةٌ بيضاء على كاونترٍ فاتح (تباينٌ ضعيف) وإضاءةٌ غير متساوية", () => {
    const img = realistic({ width: W, height: H, paper: tilted, bg: 200, paperTone: 240, noise: 8, light: (x, y) => 0.8 + 0.2 * (x / W) * (1 - y / H / 2) });
    expectNear(detectDocument(img), tilted, 20);
  });

  it("ورقةٌ تكاد تملأ الصورة", () => {
    const big: Quad = [{ x: 30, y: 25 }, { x: 870, y: 40 }, { x: 880, y: 1175 }, { x: 20, y: 1160 }];
    const img = realistic({ width: W, height: H, paper: big, bg: 120, paperTone: 235, noise: 6 });
    expectNear(detectDocument(img), big, 20);
  });

  it("الجدولُ داخل الفاتورة لا يغلب طرفَها", () => {
    const img = realistic({ width: W, height: H, paper: tilted, bg: 90, paperTone: 235, noise: 5, table: true });
    expectNear(detectDocument(img), tilted, 20);
  });

  it("يدٌ تمسك طرف الورقة", () => {
    const img = realistic({ width: W, height: H, paper: tilted, bg: 110, paperTone: 235, noise: 5, hand: { x: 120, y: 600, r: 70 } });
    expectNear(detectDocument(img), tilted, 25);
  });

  it("منظورٌ قويّ — صُوِّرت من زاوية", () => {
    const trap: Quad = [{ x: 230, y: 160 }, { x: 670, y: 170 }, { x: 830, y: 1100 }, { x: 70, y: 1080 }];
    const img = realistic({ width: W, height: H, paper: trap, bg: 170, paperTone: 238, noise: 6 });
    expectNear(detectDocument(img), trap, 25);
  });
});

describe("لا قصَّ يقطع رأس الفاتورة", () => {
  it("ورقةٌ تكاد لا تُرى على سطحٍ بلونها، وفيها جدولٌ بخطٍّ حادّ: الصورةُ كلُّها خيرٌ من قصٍّ على الجدول", () => {
    const paper: Quad = [{ x: 140, y: 110 }, { x: 760, y: 150 }, { x: 790, y: 1080 }, { x: 100, y: 1050 }];
    const img = realistic({ width: 900, height: 1200, paper, bg: 232, paperTone: 238, noise: 6, table: true });
    const q = detectDocument(img);
    /*
      إمّا الطرفُ، وإمّا حدودُ النصّ نفسه (يسقط الهامشُ الأبيض وحده)، وإمّا لا شيء —
      لا خطُّ الجدول (عند ثلث الورقة، y≈٤٥٠) أعلىً لها، فلا يُقطع ما فوقه.
    */
    if (q) {
      expect(Math.min(q[0].y, q[1].y)).toBeLessThan(215);
      expect(Math.max(q[2].y, q[3].y)).toBeGreaterThan(960);
    }
  });
});
