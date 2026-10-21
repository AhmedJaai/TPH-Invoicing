/**
 * عاملُ الاكتشاف — يجري خارج خيط الواجهة، فلا يتقطّع عرضُ الكاميرا وهو يبحث عن الورقة.
 *
 * لكلّ إطار اكتشافان: الرقعةُ البيضاء (`detectDocument`، فوريّ) ونموذجُ الزوايا المدرَّب
 * (`corner-model.ts` بـonnxruntime-web، يُحمَّل مرّةً من موقعنا). ويُختار بينهما بما تشهد
 * به حافّةُ الورقة (`pickBest`). وحتّى يُحمَّل النموذج — أو إن تعذّر — فالرقعةُ وحدها.
 *
 * والطلباتُ تُصفّ واحداً بعد واحد: جلسةُ النموذج لا تُشغَّل مرّتين معاً.
 */
import * as ort from "onnxruntime-web/wasm";
import { detectDocument, pickBest } from "@/lib/scan/detect";
import { decodeHeatmaps, letterbox, MODEL_SIDE } from "@/lib/scan/corner-model";
import type { Quad, Raster } from "@/lib/scan/geometry";

export type ModelState = "loading" | "ready" | "off";
export interface DetectRequest { id: number; width: number; height: number; data: ArrayBuffer }
export interface DetectResponse { id: number; quad: Quad | null; model: ModelState }

ort.env.wasm.wasmPaths = "/ort/";
/* بلا خيوطٍ متعدّدة: تحتاج عزلاً عبر الأصول (COEP) لا نضعه على الموقع */
ort.env.wasm.numThreads = 1;

let model: ModelState = "loading";
const session: Promise<ort.InferenceSession | null> = ort.InferenceSession
  .create("/models/doc-corners-v1.onnx", { executionProviders: ["wasm"], graphOptimizationLevel: "all" })
  .then((s) => { model = "ready"; return s; })
  .catch(() => { model = "off"; return null; });

async function modelQuad(frame: Raster): Promise<Quad | null> {
  if (model !== "ready") return null;
  const s = await session;
  if (!s) return null;
  const box = letterbox(frame);
  const out = await s.run({ input: new ort.Tensor("float32", box.input, [1, 3, MODEL_SIDE, MODEL_SIDE]) });
  const heat = out[s.outputNames[0]]?.data;
  if (!(heat instanceof Float32Array)) return null;
  return decodeHeatmaps(heat, box).quad;
}

async function handle(req: DetectRequest): Promise<DetectResponse> {
  const frame: Raster = { width: req.width, height: req.height, data: new Uint8ClampedArray(req.data) };
  let byRegion: Quad | null = null;
  let byModel: Quad | null = null;
  try { byRegion = detectDocument(frame); } catch { /* إطارٌ تعذّر — يُعامَل «لا ورقة» */ }
  try { byModel = await modelQuad(frame); } catch { /* النموذجُ تعثّر في هذا الإطار — تكفي الرقعة */ }
  let quad: Quad | null = null;
  try { quad = pickBest(frame, [byRegion, byModel]); } catch { quad = byRegion; }
  return { id: req.id, quad, model };
}

/*
  الصفُّ لا ينقطع: طلبٌ تعثّر يُجاب «لا ورقة» ويمضي ما بعده — كان رفضٌ واحدٌ يُوقف كلَّ
  ما يليه (السلسلةُ المرفوضة لا تُشغِّل `then` بعدها) فتقف الشاشة على «يجهّز الصورة».
*/
let queue: Promise<void> = Promise.resolve();
addEventListener("message", (e: MessageEvent<DetectRequest>) => {
  const req = e.data;
  queue = queue
    .then(async () => { postMessage(await handle(req)); })
    .catch(() => { const reply: DetectResponse = { id: req.id, quad: null, model }; postMessage(reply); });
});
