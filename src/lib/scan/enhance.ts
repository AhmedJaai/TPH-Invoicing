/**
 * تنظيفُ الورقة الممسوحة — ورقٌ أبيض وحبرٌ داكن، بلا ظلّ اليد ولا اصفرار الإضاءة.
 *
 * الضوءُ على الكاونتر لا يقع على الورقة بالتساوي: طرفٌ في الظلّ وطرفٌ تحت المصباح.
 * فعتبةٌ واحدة للصورة كلّها تُسوِّد الطرفَ المظلَّل وتمحو الحبرَ الباهت في المضاء.
 * فيُقدَّر لونُ الورق في كلّ موضع (أفتحُ ما في مربّعه، ثمّ يُنعَّم)، ويُقسَم عليه كلُّ
 * بكسل: الورقُ يصير أبيضَ أينما كان، والحبرُ يبقى بنسبته إليه.
 *
 * «مستند»: رماديٌّ حادّ كمسح «الملاحظات». «ألوان»: الأختامُ والتواقيعُ الملوّنة بألوانها.
 *
 * خالصةٌ — لا متصفّح.
 */
import type { Raster } from "./geometry";

export type ScanMode = "document" | "color";

const luminance = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * لونُ الورق في كلّ بكسل: أفتحُ ما في كلّ مربّع (الحبرُ أصغرُ من المربّع فلا يدخله)،
 * ثمّ تنعيمٌ مرّتين، ثمّ استيفاءٌ إلى مقاس الصورة.
 */
export function paperBackground(src: Raster): Float32Array {
  const { width, height, data } = src;
  const block = Math.max(8, Math.round(Math.max(width, height) / 40));
  const bw = Math.ceil(width / block);
  const bh = Math.ceil(height / block);
  let grid = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      /* أفتحُ قيمةٍ بعد إهمال أعلى ٢٪ — بقعةُ لمعانٍ واحدة لا تصير «لونَ الورق» */
      const hist = new Uint32Array(256);
      let n = 0;
      for (let y = by * block; y < Math.min(height, (by + 1) * block); y++) {
        for (let x = bx * block; x < Math.min(width, (bx + 1) * block); x++) {
          hist[Math.round(luminance(data, (y * width + x) * 4))]++;
          n++;
        }
      }
      let skip = Math.floor(n * 0.02);
      let v = 255;
      for (; v > 0; v--) {
        if (hist[v] > skip) break;
        skip -= hist[v];
      }
      grid[by * bw + bx] = Math.max(v, 1);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(grid.length);
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy;
            const xx = x + dx;
            if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
            s += grid[yy * bw + xx];
            c++;
          }
        }
        next[y * bw + x] = s / c;
      }
    }
    grid = next;
  }
  const bg = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(bh - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = Math.min(bw - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const fx = gx - x0;
      const top = grid[y0 * bw + x0] + (grid[y0 * bw + x1] - grid[y0 * bw + x0]) * fx;
      const bottom = grid[y1 * bw + x0] + (grid[y1 * bw + x1] - grid[y1 * bw + x0]) * fx;
      bg[y * width + x] = top + (bottom - top) * fy;
    }
  }
  return bg;
}

/** يمدّ القيمة بين نقطتي الأسود والأبيض — ما تحت الأولى أسود، وما فوق الثانية أبيض. */
const levels = (v: number, black: number, white: number) =>
  Math.max(0, Math.min(255, ((v - black) / (white - black)) * 255));

export function enhanceScan(src: Raster, mode: ScanMode): Raster {
  const bg = paperBackground(src);
  const out = new Uint8ClampedArray(src.data.length);
  const d = src.data;
  for (let p = 0, i = 0; p < bg.length; p++, i += 4) {
    const k = 255 / bg[p];
    if (mode === "document") {
      const v = levels(luminance(d, i) * k, 70, 232);
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
    } else {
      out[i] = levels(d[i] * k, 40, 240);
      out[i + 1] = levels(d[i + 1] * k, 40, 240);
      out[i + 2] = levels(d[i + 2] * k, 40, 240);
    }
    out[i + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}
