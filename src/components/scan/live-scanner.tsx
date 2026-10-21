"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Flashlight, FlashlightOff, X } from "lucide-react";
import { countNoun, PAGE } from "@/lib/arabic";
import { detectDocument } from "@/lib/scan/detect";
import type { Quad, Raster } from "@/lib/scan/geometry";
import { StabilityTracker, type ScanState } from "@/lib/scan/stability";
import type { DetectRequest, DetectResponse } from "./detect.worker";

/**
 * الماسحُ الحيّ — كمسح المستندات في «الملاحظات».
 *
 * الكاميرا تعمل، وكلُّ إطارٍ مصغّرٍ يُرسل إلى عاملٍ يكتشف الورقة (`detect.worker.ts`)،
 * فتُظلَّل الورقةُ على الشاشة حين تُعرف. وحين تثبت نحو ثانية (`StabilityTracker`)
 * يُلتقط الإطارُ بدقّته الكاملة وحده، وتُقوَّم الورقةُ وتُنظَّف، ويبقى الماسحُ مفتوحاً
 * للصفحة التالية. وزرُّ الالتقاط باليد لما لا يُعرف وحده.
 */

/** أطولُ ضلعٍ للإطار الذي يُبحث فيه — يكفي للاكتشاف ويجري بسرعة */
const DETECT_SIDE = 480;
/** أقلُّ فاصلٍ بين إطارين يُرسلان للاكتشاف */
const DETECT_INTERVAL_MS = 90;

const HINT: Record<ScanState["kind"] | "STARTING", string> = {
  STARTING: "تفتح الكاميرا…",
  SEARCHING: "وجّه الكاميرا نحو الفاتورة",
  TOO_SMALL: "قرّب الجوال من الفاتورة",
  HOLDING: "ثبّت الجوال…",
  CAPTURED: "التُقطت. ضع الصفحة التالية، أو اضغط «تم»",
};

/** الكشّافُ قيدٌ متقدّم في كروم أندرويد لا تعرفه أنواعُ المتصفّح القياسيّة */
interface TorchConstraint extends MediaTrackConstraintSet { torch?: boolean }

export interface LiveScannerProps {
  pageCount: number;
  lastThumb: string | null;
  /** إطارٌ بدقّته الكاملة وزوايا الورقة فيه (`null`: لم تُعرف — يُحدِّدها المستخدم) */
  onCapture: (frame: Raster, quad: Quad | null) => Promise<void>;
  onDone: () => void;
  /** لا كاميرا حيّة (منعٌ أو متصفّحٌ قديم) — يُفتح التصويرُ العاديّ */
  onFallback: (reason: string) => void;
}

export function LiveScanner({ pageCount, lastThumb, onCapture, onDone, onFallback }: LiveScannerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<StabilityTracker | null>(null);
  const capturing = useRef(false);
  const [state, setState] = useState<ScanState | { kind: "STARTING" }>({ kind: "STARTING" });
  const [display, setDisplay] = useState<Quad | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const dimsRef = useRef(dims);
  const [flash, setFlash] = useState(false);
  const [auto, setAuto] = useState(true);
  const [torch, setTorch] = useState<boolean | null>(null);
  const autoRef = useRef(auto);
  useEffect(() => { autoRef.current = auto; }, [auto]);

  /* ── الكاميرا ── */
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onFallback("هذا المتصفح لا يفتح الكاميرا داخل الصفحة.");
        return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1440 } },
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        const v = video.current;
        if (!v) return;
        v.srcObject = s;
        await v.play().catch(() => undefined);
        const track = s.getVideoTracks()[0];
        const caps = typeof track?.getCapabilities === "function" ? track.getCapabilities() : null;
        if (caps && "torch" in caps) setTorch(false);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        onFallback(name === "NotAllowedError"
          ? "لم يُسمح للصفحة باستخدام الكاميرا. اسمح بها من إعدادات المتصفح، أو صوّر بالكاميرا العادية."
          : "تعذّر فتح الكاميرا داخل الصفحة. صوّر بالكاميرا العادية.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
    };
  }, [onFallback]);

  /* مقاسُ ما يُعرض فيه — لرسم الإطار فوق الفيديو المقصوص (object-cover) */
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** إطارٌ من الفيديو بدقّته الكاملة */
  const grabFull = useCallback((): Raster | null => {
    const v = video.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: img.width, height: img.height, data: img.data };
  }, []);

  const capture = useCallback(async (hint: Quad | null) => {
    if (capturing.current) return;
    capturing.current = true;
    try {
      const frame = grabFull();
      if (!frame) return;
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
      /* اكتشافٌ ثانٍ بالدقّة الكاملة أدقُّ زوايا — وإلّا فما ثبت في الإطار المصغّر */
      const quad = detectDocument(frame) ?? hint;
      tracker.current?.markCaptured(hint);
      await onCapture(frame, quad);
    } finally {
      capturing.current = false;
    }
  }, [grabFull, onCapture]);

  /* ── حلقةُ الاكتشاف ── */
  useEffect(() => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./detect.worker.ts", import.meta.url), { type: "module" });
    } catch {
      worker = null;
    }
    const small = document.createElement("canvas");
    const ctx = small.getContext("2d", { willReadFrequently: true });
    let raf = 0;
    let busy = false;
    let lastSent = 0;
    let id = 0;
    let scale = 1;

    const handle = (quad: Quad | null) => {
      const v = video.current;
      if (!v || !v.videoWidth) return;
      if (!tracker.current) tracker.current = new StabilityTracker({ width: v.videoWidth, height: v.videoHeight });
      /* من الإطار المصغّر إلى بكسلات الفيديو */
      const full = quad ? quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) : null;
      const q: Quad | null = full ? [full[0], full[1], full[2], full[3]] : null;
      const r = tracker.current.update(q, performance.now());
      setDisplay(r.display);
      setState(r.state);
      if (r.capture && autoRef.current && !capturing.current) void capture(q);
    };

    if (worker) {
      worker.onmessage = (e: MessageEvent<DetectResponse>) => {
        busy = false;
        handle(e.data.quad);
      };
      worker.onerror = () => { busy = false; };
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth || !ctx || busy || capturing.current) return;
      if (now - lastSent < DETECT_INTERVAL_MS) return;
      if (dimsRef.current.w !== v.videoWidth || dimsRef.current.h !== v.videoHeight) {
        dimsRef.current = { w: v.videoWidth, h: v.videoHeight };
        setDims(dimsRef.current);
        /* الإطارُ تغيّر (دار الجوال): يُعاد العدّ على مقاسه الجديد */
        tracker.current = null;
      }
      scale = Math.min(1, DETECT_SIDE / Math.max(v.videoWidth, v.videoHeight));
      small.width = Math.round(v.videoWidth * scale);
      small.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, small.width, small.height);
      const img = ctx.getImageData(0, 0, small.width, small.height);
      lastSent = now;
      busy = true;
      if (worker) {
        const msg: DetectRequest = { id: ++id, width: img.width, height: img.height, data: img.data.buffer };
        worker.postMessage(msg, [img.data.buffer]);
      } else {
        /* بلا عامل: على خيط الواجهة، والإطارُ التالي بعد انتهائه */
        handle(detectDocument({ width: img.width, height: img.height, data: img.data }));
        busy = false;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      worker?.terminate();
    };
  }, [capture]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      const advanced: TorchConstraint[] = [{ torch: !torch }];
      await track.applyConstraints({ advanced });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  /* بكسلُ الفيديو ← موضعُه على الشاشة (object-cover: يُكبَّر حتّى يملأ ويُقصّ الزائد) */
  const k = dims.w && box.w ? Math.max(box.w / dims.w, box.h / dims.h) : 0;
  const ox = (box.w - dims.w * k) / 2;
  const oy = (box.h - dims.h * k) / 2;
  const points = display && k ? display.map((p) => `${p.x * k + ox},${p.y * k + oy}`).join(" ") : null;
  const holding = state.kind === "HOLDING" ? state.progress : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label="ماسح الفواتير">
      <div ref={stage} className="relative flex-1 overflow-hidden">
        <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />
        {points && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden>
            <polygon
              points={points}
              fill="rgb(250 204 21 / 0.28)"
              stroke="rgb(250 204 21)"
              strokeWidth={3}
              strokeLinejoin="round"
              className="transition-[points] duration-100 ease-out motion-reduce:transition-none"
            />
          </svg>
        )}
        {flash && <div className="pointer-events-none absolute inset-0 bg-white/70" aria-hidden />}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button type="button" onClick={onDone} aria-label="أغلق الماسح" className="grid h-11 w-11 place-items-center rounded-full bg-black/50">
            <X className="h-5 w-5" aria-hidden />
          </button>
          <p className="rounded-full bg-black/55 px-3 py-1.5 text-center text-xs font-bold" aria-live="polite">{HINT[state.kind]}</p>
          {torch !== null ? (
            <button type="button" onClick={() => void toggleTorch()} aria-label={torch ? "أطفئ الكشاف" : "شغّل الكشاف"} aria-pressed={torch}
              className={`grid h-11 w-11 place-items-center rounded-full ${torch ? "bg-yellow-300 text-black" : "bg-black/50"}`}>
              {torch ? <Flashlight className="h-5 w-5" aria-hidden /> : <FlashlightOff className="h-5 w-5" aria-hidden />}
            </button>
          ) : <span className="h-11 w-11" />}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        <button type="button" onClick={onDone} disabled={pageCount === 0} aria-label={`تم — ${countNoun(pageCount, PAGE)}`}
          className="relative h-14 w-11 overflow-hidden rounded-md border border-white/40 bg-white/10 disabled:opacity-30">
          {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ لآخر صفحةٍ مُلتقطة */}
          {lastThumb && <img src={lastThumb} alt="" className="h-full w-full object-cover" />}
          {pageCount > 0 && (
            <span className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-yellow-300 px-1 text-[11px] font-bold text-black">
              {pageCount.toLocaleString("ar-SA")}
            </span>
          )}
        </button>

        <button type="button" onClick={() => void capture(display)} aria-label="التقط الآن"
          className="relative grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full border-4 border-white">
          <svg className="absolute inset-[-6px] h-[calc(100%+12px)] w-[calc(100%+12px)] -rotate-90" viewBox="0 0 40 40" aria-hidden>
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgb(250 204 21)" strokeWidth="2.5"
              strokeDasharray={`${holding * 113} 113`} className="transition-[stroke-dasharray] duration-100" />
          </svg>
          <span className="h-14 w-14 rounded-full bg-white" />
        </button>

        <div className="flex w-16 flex-col items-center gap-2">
          <button type="button" onClick={() => setAuto((a) => !a)} aria-pressed={auto}
            className={`min-h-11 w-full rounded-full px-2 text-xs font-bold ${auto ? "bg-yellow-300 text-black" : "bg-white/15"}`}>
            {auto ? "تلقائي" : "يدوي"}
          </button>
          {pageCount > 0 && (
            <button type="button" onClick={onDone} className="min-h-11 w-full rounded-full bg-white px-2 text-xs font-bold text-black">
              <Check className="inline h-3.5 w-3.5" aria-hidden /> تم
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
