/**
 * عاملُ الاكتشاف — يجري خارج خيط الواجهة، فلا يتقطّع عرضُ الكاميرا وهو يبحث عن الورقة.
 *
 * يستلم إطاراً مصغّراً (RGBA) ويُرجع زوايا الورقة فيه أو `null`. والخوارزميّةُ نفسُها
 * التي تُختبر (`lib/scan/detect.ts`) — لا نسخةٌ ثانية.
 */
import { detectDocument } from "@/lib/scan/detect";
import type { Quad } from "@/lib/scan/geometry";

export interface DetectRequest { id: number; width: number; height: number; data: ArrayBuffer }
export interface DetectResponse { id: number; quad: Quad | null }

addEventListener("message", (e: MessageEvent<DetectRequest>) => {
  const { id, width, height, data } = e.data;
  let quad: Quad | null = null;
  try {
    quad = detectDocument({ width, height, data: new Uint8ClampedArray(data) });
  } catch {
    /* إطارٌ تعذّر — يُعامَل «لا ورقة»، والإطارُ التالي بعد أجزاءٍ من الثانية */
  }
  const reply: DetectResponse = { id, quad };
  postMessage(reply);
});
