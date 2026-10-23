/**
 * المكتشِفُ المشترك — عاملٌ واحدٌ للماسح الحيّ ولصورة الكاميرا، ونموذجُه يُحمَّل مرّةً.
 *
 * `detect(frame)` يُرجع زوايا الورقة بإحداثيّات الإطار المعطى. والإطارُ الكبير يُصغَّر قبل
 * الإرسال (أطولُ ضلعٍ ١٢٨٠) ثمّ تُكبَّر الزوايا إليه — الاكتشافُ لا يحتاج أكثر، والتدقيقُ
 * داخله بدقّة ٩٠٠. وبلا عامل (متصفّحٌ قديم): الرقعةُ البيضاء على خيط الواجهة.
 *
 * للمتصفّح وحده.
 */
import { detectDocument } from "@/lib/scan/detect";
import type { Quad, Raster } from "@/lib/scan/geometry";
import type { DetectRequest, DetectResponse, ModelState } from "./detect.worker";

const SEND_SIDE = 1280;
/** أقصى انتظارٍ لجواب العامل */
const DETECT_TIMEOUT_MS = 8000;

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, (r: DetectResponse) => void>();
let modelState: ModelState = "loading";

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL("./detect.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<DetectResponse>) => {
      modelState = e.data.model;
      pending.get(e.data.id)?.(e.data);
      pending.delete(e.data.id);
    };
    worker.onerror = () => {
      pending.forEach((resolve, id) => resolve({ id, quad: null, model: "off" }));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** يبدأ تحميل النموذج قبل أن يُطلب — حين تُفتح صفحةُ الماسح */
export function warmDetector() {
  getWorker();
}

/** إطارٌ مصغّرٌ إلى `side` (أطولُ ضلع) — نسخةٌ جديدة تُنقل إلى العامل */
function shrink(frame: Raster, side: number): { raster: Raster; scale: number } {
  const scale = Math.min(1, side / Math.max(frame.width, frame.height));
  if (scale === 1) return { raster: frame, scale };
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  const small = document.createElement("canvas");
  small.width = Math.round(frame.width * scale);
  small.height = Math.round(frame.height * scale);
  const sctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx || !sctx) return { raster: frame, scale: 1 };
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height), 0, 0);
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(canvas, 0, 0, small.width, small.height);
  const img = sctx.getImageData(0, 0, small.width, small.height);
  return { raster: { width: img.width, height: img.height, data: img.data }, scale };
}

export async function detect(frame: Raster): Promise<Quad | null> {
  const w = getWorker();
  if (!w) return detectDocument(frame);
  const { raster, scale } = shrink(frame, SEND_SIDE);
  const id = ++seq;
  const reply = await new Promise<DetectResponse>((resolve) => {
    /* لا انتظارَ بلا حدّ: عاملٌ علق أو نموذجٌ يُحمَّل ببطء — «لا ورقة» والزوايا باليد */
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ id, quad: null, model: modelState });
    }, DETECT_TIMEOUT_MS);
    pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    /* نسخةٌ مستقلّة تُنقل (لا تُنسخ) إلى العامل */
    const data = new Uint8ClampedArray(raster.data);
    const msg: DetectRequest = { id, width: raster.width, height: raster.height, data: data.buffer };
    w.postMessage(msg, [data.buffer]);
  });
  if (!reply.quad) return null;
  const up = (p: { x: number; y: number }) => ({ x: p.x / scale, y: p.y / scale });
  return [up(reply.quad[0]), up(reply.quad[1]), up(reply.quad[2]), up(reply.quad[3])];
}
