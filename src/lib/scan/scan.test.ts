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
      expect(Math.abs(p.x - PAPER[i].x)).toBeLessThan(8);
      expect(Math.abs(p.y - PAPER[i].y)).toBeLessThan(8);
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
