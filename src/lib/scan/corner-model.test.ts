import { describe, expect, it } from "vitest";
import { decodeHeatmaps, letterbox, MODEL_SIDE } from "./corner-model";

const S = MODEL_SIDE;

describe("مُدخلُ النموذج ومُخرجُه", () => {
  it("الصورةُ الطوليّة في وسط المربّع، والفراغُ حولها أسودُ مُطبَّع", () => {
    const src = { width: 720, height: 1280, data: new Uint8ClampedArray(720 * 1280 * 4).fill(255) };
    const box = letterbox(src);
    expect(box.scale).toBeCloseTo(S / 1280);
    expect(box.y0).toBe(0);
    expect(box.x0).toBe(Math.floor((S - Math.round(720 * box.scale)) / 2));
    /* بكسلٌ أبيضُ داخل الصورة، وأسودُ في الهامش — القناةُ الحمراء */
    const white = box.input[112 * S + 112];
    const black = box.input[112 * S + 2];
    expect(white).toBeCloseTo((1 - 0.485) / 0.229, 2);
    expect(black).toBeCloseTo(-0.485 / 0.229, 2);
  });

  it("قممُ خرائط الحرارة ← زوايا الصورة الأصل، بدقّةٍ دون البكسل", () => {
    const src = { width: 720, height: 1280, data: new Uint8ClampedArray(4) };
    const box = letterbox({ ...src, data: new Uint8ClampedArray(720 * 1280 * 4) });
    const truth = [{ x: 100, y: 80 }, { x: 600, y: 120 }, { x: 640, y: 1200 }, { x: 60, y: 1150 }];
    const heat = new Float32Array(4 * S * S);
    truth.forEach((p, k) => {
      const hx = p.x * box.scale + box.x0 - 0.5;
      const hy = p.y * box.scale + box.y0 - 0.5;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        heat[k * S * S + y * S + x] = Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / 2);
      }
    });
    const { quad, confidence } = decodeHeatmaps(heat, box);
    quad.forEach((p, i) => {
      expect(Math.abs(p.x - truth[i].x)).toBeLessThan(3);
      expect(Math.abs(p.y - truth[i].y)).toBeLessThan(3);
    });
    expect(confidence).toBeGreaterThan(0.5);
  });
});
