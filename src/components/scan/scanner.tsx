"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  Camera, Check, CircleAlert, Crop, CircleCheck, Clock, FileText, ImagePlus, Palette, Plus, RotateCcw, ScanLine, Send, Trash2, X,
} from "lucide-react";
import { BrandMark } from "@/components/icons";
import { LiveScanner } from "./live-scanner";
import { detect, warmDetector } from "./detector";

const noSubscribe = () => () => {};
/** آيفون أو آيباد (والآيباد الحديث يعلن نفسَه «ماك» ذا لمس) */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
import { buttonClass } from "@/components/ui-tokens";
import { readResponse } from "@/lib/http-client";
import { countNoun, PAGE, timeAgo } from "@/lib/arabic";
import type { ClarityVerdict } from "@/lib/capture-clarity";
import { imagesToPdf, type JpegPage } from "@/lib/images-to-pdf";
import { enhanceScan, type ScanMode } from "@/lib/scan/enhance";
import { frameSpan, insetQuad, orderQuad, warpQuad, type Point, type Quad, type Raster } from "@/lib/scan/geometry";
import { assessQuality, QUALITY_MESSAGE, type QualityIssue } from "@/lib/scan/quality";

/**
 * ماسحُ الباريستا — كمسح المستندات في «الملاحظات».
 *
 *   صوِّر ← تُكتشف حوافُّ الورقة (ويسحب زواياها إن أخطأت) ← تُقوَّم وتُنظَّف
 *   ← فحصٌ على الجهاز (مهزوزة · مظلمة · لمعة · بعيدة) ← «افحص الوضوح»: يقرؤها
 *   الذكاء ويعرض ما قرأه ← «أرسل».
 *
 * الكاميرا كاميرا الجوال نفسُها (`capture`) — أدقّ من كاميرا المتصفّح وتركيزُها
 * أسرع. والمعالجةُ كلُّها على الجهاز؛ ولا يخرج إلّا الملفُّ النظيف.
 */

/** أطولُ ضلعٍ للصورة التي تُعالَج — والناتجُ دونه */
const SOURCE_SIDE = 2400;
const OUTPUT_SIDE = 2000;
const JPEG_QUALITY = 0.82;
const MAX_SEND_BYTES = 3.8 * 1024 * 1024;

interface SentItem {
  id: string;
  createdAt: string;
  status: "PENDING" | "ARCHIVED" | "REJECTED";
  note: string | null;
  decisionNote: string | null;
}

interface ScanPage {
  id: string;
  /** الورقةُ مقوَّمةً قبل التنظيف — يُعاد منها التنظيفُ إن تغيّر النمط */
  warped: Raster;
  jpeg: Uint8Array;
  url: string;
  width: number;
  height: number;
  issues: QualityIssue[];
  /** الإطارُ الأصل وزواياه — لـ«عدّل الحدود» بعد الالتقاط */
  source: Raster;
  quad: Quad;
}

type Check =
  | { kind: "verdict"; verdict: ClarityVerdict }
  | { kind: "outage"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "duplicate"; where: "DOCUMENT" | "CAPTURE" };

type Stage =
  | { kind: "home" }
  | { kind: "preparing" }
  /** الماسحُ الحيّ مفتوح */
  | { kind: "live" }
  /** مسحٌ جاهز من ماسح الجوال — يُرسل كما هو */
  | { kind: "ready"; name: string; pdf: boolean; url: string | null }
  | { kind: "adjust"; source: Raster; url: string; quad: Quad; detected: boolean; replaceId?: string }
  | { kind: "pages" }
  | { kind: "checking"; startedAt: number }
  | { kind: "checked"; result: Check }
  | { kind: "sending" }
  | { kind: "sent"; duplicate: boolean };

/* ─────────────────────── المعالجة على الجهاز ─────────────────────── */

async function loadRaster(file: File): Promise<{ raster: Raster; url: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    /* المتصفّحُ يقوّم اتّجاه الصورة من بياناتها (EXIF) حين يرسمها — صورةُ الجوال الطوليّة تبقى طوليّة */
    await img.decode();
    const scale = Math.min(1, SOURCE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no-canvas");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const shown = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.8));
    return {
      raster: { width: data.width, height: data.height, data: data.data },
      url: shown ? URL.createObjectURL(shown) : url,
    };
  } finally {
    /* الرابطُ الأصليّ يُحرَّر — ما يُعرض نسخةٌ مصغّرة */
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function encodeJpeg(r: Raster): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = r.width;
  canvas.height = r.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no-canvas");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("no-blob");
  return new Uint8Array(await blob.arrayBuffer());
}

/** يعطي المتصفّح فرصةً ليرسم «يجهّز…» قبل الحساب الثقيل. */
const paint = () => new Promise((r) => setTimeout(r, 40));

let seq = 0;
const newId = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

/** الصفحاتُ ملفّاً واحداً: صورةٌ إن كانت واحدة، وPDF إن كانت أكثر. */
function buildFile(pages: readonly ScanPage[]): File {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  if (pages.length === 1) {
    return new File([new Uint8Array(pages[0].jpeg)], `فاتورة-ورقية-${stamp}.jpg`, { type: "image/jpeg" });
  }
  const pdf = imagesToPdf(pages.map<JpegPage>((p) => ({ jpeg: p.jpeg, width: p.width, height: p.height })));
  return new File([pdf], `فاتورة-ورقية-${stamp}.pdf`, { type: "application/pdf" });
}

/* ─────────────────────── الشاشة ─────────────────────── */

export function Scanner({ token, label, recent }: { token: string; label: string; recent: SentItem[] }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "home" });
  const [pages, setPages] = useState<ScanPage[]>([]);
  /* ألوانٌ طبيعيّة أوّلاً كـ«الملاحظات» — و«مستند» رماديٌّ لمن أراده */
  const [mode, setMode] = useState<ScanMode>("color");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  /** الملفُّ الذي فُحص — يُرسَل هو نفسُه، فتُعاد قراءتُه من الخزين لا من النموذج */
  const built = useRef<File | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const readyInput = useRef<HTMLInputElement>(null);

  /* روابطُ المعاينة تُحرَّر حين تُترك الصفحات */
  const pagesRef = useRef(pages);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  /** لا كاميرا حيّة في هذا المتصفّح (منعٌ أو قِدَم) — فالتصويرُ العاديّ */
  const [liveUnavailable, setLiveUnavailable] = useState(false);

  /*
    الآيفون: كاميرا الجوال نفسُها — صورةٌ كاملة بمعالجة أبل (HDR وتركيز)، والمتصفّحُ هناك
    لا يعطي الصفحةَ إلّا إطارَ فيديو أضعف منها. ثمّ تُكتشف الورقةُ وتُقوَّم آليّاً. وغيرُه:
    الماسحُ الحيّ (أندرويد يلتقط صورةً حقيقيّة بدقّة المستشعر).
  */
  const ios = useSyncExternalStore(noSubscribe, isIOS, () => false);
  const openCamera = useCallback(() => {
    setError(null);
    if (ios || liveUnavailable || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) cameraInput.current?.click();
    else setStage({ kind: "live" });
  }, [ios, liveUnavailable]);
  const openLive = useCallback(() => { setError(null); setStage({ kind: "live" }); }, []);

  /* النموذجُ يُحمَّل والباريستا ما زال في الصفحة الأولى — جاهزٌ حين يصوّر */
  useEffect(() => { warmDetector(); }, []);
  /* والقارئُ في الخادم يُسخَّن كذلك — يبدأ بارداً فيضيف ثوانيَ إلى أوّل فحص */
  useEffect(() => { void fetch("/api/capture/scan/check", { cache: "no-store" }).catch(() => undefined); }, []);

  const onPicked = useCallback(async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    setStage({ kind: "preparing" });
    await paint();
    try {
      const { raster, url } = await loadRaster(file);
      const found = await detect(raster).catch(() => null);
      setStage({ kind: "adjust", source: raster, url, quad: found ?? insetQuad(raster.width, raster.height), detected: Boolean(found) });
    } catch {
      setError("لم يستطع الجوال فتح هذه الصورة. صوّرها مرة أخرى بالكاميرا.");
      setStage({ kind: pagesRef.current.length ? "pages" : "home" });
    }
  }, []);

  /*
    مسحٌ جاهز من ماسح الجوال نفسه («الملفات» أو «الملاحظات» في الآيفون — ماسحُ أبل):
    جودتُه جودةُ أبل، فلا يُقصّ ولا يُنظَّف ثانيةً. يُفحص ويُرسل كما هو.
  */
  const onReady = useCallback((list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setError(null);
    if (file.size > MAX_SEND_BYTES) {
      setError("الملف أكبر من حد الإرسال. امسح صفحات أقل في المرة الواحدة.");
      return;
    }
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    built.current = file;
    setStage({ kind: "ready", name: file.name, pdf: file.type === "application/pdf" || /\.pdf$/i.test(file.name), url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  }, []);

  /** إطارٌ وزواياه ← صفحةٌ مقوَّمةٌ منظَّفة */
  const makePage = useCallback(async (source: Raster, quad: Quad, id = newId()): Promise<ScanPage> => {
    const warped = warpQuad(source, quad, OUTPUT_SIDE);
    const quality = assessQuality(warped, frameSpan(quad, source.width, source.height));
    const clean = enhanceScan(warped, mode);
    const jpeg = await encodeJpeg(clean);
    return {
      id, warped, jpeg, width: clean.width, height: clean.height, issues: quality.issues, source, quad,
      url: URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })),
    };
  }, [mode]);

  const acceptCrop = useCallback(async (source: Raster, url: string, quad: Quad, replaceId?: string) => {
    setStage({ kind: "preparing" });
    await paint();
    try {
      const page = await makePage(source, quad, replaceId);
      URL.revokeObjectURL(url);
      built.current = null;
      setPages((prev) => {
        if (!replaceId) return [...prev, page];
        return prev.map((p) => {
          if (p.id !== replaceId) return p;
          URL.revokeObjectURL(p.url);
          return page;
        });
      });
      setStage({ kind: "pages" });
    } catch {
      setError("تعذّر تجهيز الصورة. صوّرها مرة أخرى.");
      setStage({ kind: pagesRef.current.length ? "pages" : "home" });
    }
  }, [makePage]);

  /* ── الماسحُ الحيّ ── */
  const onLiveCapture = useCallback(async (frame: Raster, quad: Quad | null) => {
    if (quad) {
      const page = await makePage(frame, quad);
      built.current = null;
      setPages((prev) => [...prev, page]);
      return;
    }
    /* التُقطت باليد ولم تُعرف الورقة: تُحدَّد زواياها بالإصبع */
    const jpeg = await encodeJpeg(frame);
    const url = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
    setStage({ kind: "adjust", source: frame, url, quad: insetQuad(frame.width, frame.height), detected: false });
  }, [makePage]);

  const onLiveDone = useCallback(() => {
    setStage({ kind: pagesRef.current.length ? "pages" : "home" });
  }, []);

  const onLiveFallback = useCallback((reason: string) => {
    setLiveUnavailable(true);
    setError(`${reason} اضغط «صوّر الفاتورة» مرة أخرى.`);
    setStage({ kind: pagesRef.current.length ? "pages" : "home" });
  }, []);

  /** «عدّل الحدود» لصفحةٍ التُقطت — من إطارها الأصل وزواياها */
  const adjustPage = useCallback(async (id: string) => {
    const page = pagesRef.current.find((p) => p.id === id);
    if (!page) return;
    setStage({ kind: "preparing" });
    await paint();
    const jpeg = await encodeJpeg(page.source);
    const url = URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }));
    setStage({ kind: "adjust", source: page.source, url, quad: page.quad, detected: true, replaceId: id });
  }, []);

  /** النمطُ (مستند · ألوان) يُعاد على الصفحات كلّها من نسختها المقوَّمة */
  const switchMode = useCallback(async (next: ScanMode) => {
    if (next === mode) return;
    setMode(next);
    setStage({ kind: "preparing" });
    await paint();
    const redone: ScanPage[] = [];
    for (const p of pagesRef.current) {
      const clean = enhanceScan(p.warped, next);
      const jpeg = await encodeJpeg(clean);
      URL.revokeObjectURL(p.url);
      redone.push({ ...p, jpeg, url: URL.createObjectURL(new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" })) });
    }
    built.current = null;
    setPages(redone);
    setStage({ kind: "pages" });
  }, [mode]);

  const removePage = useCallback((id: string) => {
    built.current = null;
    setPages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      const rest = prev.filter((p) => p.id !== id);
      if (rest.length === 0) setStage({ kind: "home" });
      return rest;
    });
  }, []);

  const startOver = useCallback(() => {
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    built.current = null;
    setPages([]);
    setNote("");
    setError(null);
    setStage({ kind: "home" });
  }, []);

  const fileForSending = useCallback((quiet = false): File | null => {
    if (built.current) return built.current;
    if (pagesRef.current.length === 0) return null;
    const file = buildFile(pagesRef.current);
    if (file.size > MAX_SEND_BYTES) {
      if (!quiet) setError("الصفحات أكبر من حد الإرسال. احذف صفحة وأرسلها في فاتورة مستقلة.");
      return null;
    }
    built.current = file;
    return file;
  }, []);

  /*
    القراءةُ تبدأ في الخلفية حين تجهز الصفحات، لا حين يُضغط «افحص الوضوح».

    كانت تبدأ بالضغط فينتظر الباريستا رفعَ الصورة وقراءتَها كاملتين (نحو ربع دقيقة
    في الإنتاج). والآن تجري وهو ينظر في صفحاته، فيجدها جاهزةً أو قاربت. ولكلّ ملفٍّ
    قراءتُه: إن تغيّرت الصفحاتُ صار ملفّاً آخر، وما قُرئ للأوّل يبقى في خزين الخادم.
  */
  const reading = useRef<{ file: File; startedAt: number; result: Promise<Check> } | null>(null);
  const [background, setBackground] = useState<{ key: object; done: boolean } | null>(null);

  const startReading = useCallback((file: File, key: object) => {
    if (reading.current?.file === file) return reading.current;
    const body = new FormData();
    body.append("token", token);
    body.append("file", file);
    const result = (async (): Promise<Check> => {
      try {
        const res = await fetch("/api/capture/scan/check", { method: "POST", body });
        const read = await readResponse<{ verdict?: ClarityVerdict; outage?: boolean; message?: string; duplicate?: "DOCUMENT" | "CAPTURE" }>(res);
        if (!read.ok) return { kind: "failed", message: read.error };
        const d = read.data;
        if (d.duplicate) return { kind: "duplicate", where: d.duplicate };
        if (d.verdict) return { kind: "verdict", verdict: d.verdict };
        if (d.outage) return { kind: "outage", message: d.message ?? "" };
        return { kind: "failed", message: d.message ?? "تعذّرت قراءة الصورة." };
      } catch {
        return { kind: "failed", message: "لا يوجد اتصال بالإنترنت. تأكد من الشبكة ثم أعد الفحص." };
      }
    })();
    const entry = { file, startedAt: Date.now(), result };
    reading.current = entry;
    setBackground({ key, done: false });
    void result.then(() => {
      if (reading.current === entry) setBackground({ key, done: true });
    });
    return entry;
  }, [token]);

  /* ما يميّز ما على الشاشة: مصفوفةُ الصفحات، أو المسحُ الجاهز نفسُه */
  const readingKey: object | null = stage.kind === "pages" ? pages : stage.kind === "ready" ? stage : null;

  useEffect(() => {
    if (!readingKey) return;
    /* مهلةٌ قصيرة: من يضيف صفحةً أو يبدّل النمط فوراً لا تُدفع له قراءةٌ تُرمى */
    const timer = setTimeout(() => {
      const file = fileForSending(true);
      if (file) startReading(file, readingKey);
    }, 700);
    return () => clearTimeout(timer);
  }, [readingKey, fileForSending, startReading]);

  const check = useCallback(async () => {
    setError(null);
    const file = fileForSending();
    if (!file) return;
    const prefetched = reading.current?.file === file;
    let entry = startReading(file, readingKey ?? file);
    setStage({ kind: "checking", startedAt: entry.startedAt });
    let result = await entry.result;
    /* ما تعثّر في الخلفية (انقطاعٌ لحظيّ) يُعاد مرّةً الآن — لا يُعرض فشلٌ قديم */
    if (result.kind === "failed" && prefetched && reading.current === entry) {
      reading.current = null;
      entry = startReading(file, readingKey ?? file);
      setStage({ kind: "checking", startedAt: entry.startedAt });
      result = await entry.result;
    }
    /* تُرك الفحصُ (ألغى أو بدأ من جديد) — لا يُقفَز به إلى نتيجةٍ لم يعد ينتظرها */
    if (built.current !== file) return;
    setStage({ kind: "checked", result });
  }, [fileForSending, readingKey, startReading]);

  const send = useCallback(async () => {
    setError(null);
    const file = fileForSending();
    if (!file) return;
    const before = stage;
    setStage({ kind: "sending" });
    const body = new FormData();
    body.append("token", token);
    body.append("file", file);
    if (note.trim()) body.append("note", note.trim());
    try {
      const res = await fetch("/api/capture/scan/submit", { method: "POST", body });
      const read = await readResponse<{ id?: string; duplicate?: string }>(res);
      if (!read.ok) {
        setError(read.error);
        setStage(before);
        return;
      }
      pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
      built.current = null;
      setPages([]);
      setNote("");
      setStage({ kind: "sent", duplicate: Boolean(read.data.duplicate) });
      router.refresh();
    } catch {
      setError("لم تُرسَل: لا يوجد اتصال بالإنترنت. صورتك ما زالت هنا، فأعد الإرسال حين يعود الاتصال.");
      setStage(before);
    }
  }, [fileForSending, note, router, stage, token]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-surface px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="flex items-center gap-3 py-2">
        <BrandMark className="h-8 w-auto text-accent" />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">أهلاً {label}</p>
          <p className="text-xs text-muted">صوّر الفاتورة الورقية حين تستلمها</p>
        </div>
        {pages.length > 0 && stage.kind !== "sending" && stage.kind !== "checking" && stage.kind !== "preparing" && (
          <button type="button" onClick={startOver} className={`${buttonClass("quiet", "sm")} ms-auto`}>
            <X className="h-4 w-4" aria-hidden /> ألغِ
          </button>
        )}
      </header>

      <input ref={cameraInput} aria-label="صوّر الفاتورة بالكاميرا" type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { void onPicked(e.target.files); e.target.value = ""; }} />
      <input ref={galleryInput} aria-label="اختر صورة الفاتورة من الجوال" type="file" accept="image/*" className="hidden"
        onChange={(e) => { void onPicked(e.target.files); e.target.value = ""; }} />
      {/* ملفٌّ جاهز من ماسح الآيفون (PDF) أو صورةٌ ممسوحة — يُرسل كما هو بلا قصٍّ ولا تنظيف */}
      <input ref={readyInput} aria-label="ارفع مسحاً جاهزاً من ماسح الجوال" type="file" accept="application/pdf,image/*" className="hidden"
        onChange={(e) => { onReady(e.target.files); e.target.value = ""; }} />

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2.5 text-sm text-danger">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {stage.kind === "home" && (
        <Home onCamera={openCamera} onLive={ios && !liveUnavailable ? openLive : undefined} onGallery={() => galleryInput.current?.click()} onReady={() => readyInput.current?.click()} recent={recent} />
      )}

      {stage.kind === "preparing" && <Busy text="يجهّز الصورة…" />}

      {stage.kind === "ready" && (
        <section className="mt-4 flex flex-col">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-3 shadow-raised">
            {stage.url ? (
              /* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ للمسح المختار */
              <img src={stage.url} alt="" className="h-20 w-16 rounded-md border border-line object-cover" />
            ) : (
              <span className="grid h-20 w-16 place-items-center rounded-md border border-line bg-sunken"><FileText className="h-6 w-6 text-muted" aria-hidden /></span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-bold" dir="auto">{stage.name}</p>
              <p className="text-xs text-muted">مسحٌ جاهز من ماسح الجوال، يُرسل كما هو.</p>
            </div>
          </div>
          <div className="mt-4">
            <CheckButton onClick={() => void check()} reading={background?.key === stage ? (background.done ? "done" : "running") : null} />
          </div>
          <button type="button" onClick={startOver} className={`${buttonClass("quiet", "md")} mt-2 w-full`}>اختر ملفاً آخر</button>
        </section>
      )}

      {stage.kind === "adjust" && (
        <Adjust
          stage={stage}
          onChange={(quad) => setStage({ ...stage, quad })}
          onDone={() => void acceptCrop(stage.source, stage.url, stage.quad, stage.replaceId)}
          onRetake={() => { URL.revokeObjectURL(stage.url); setStage({ kind: pages.length ? "pages" : "home" }); openCamera(); }}
          onFull={() => setStage({ ...stage, quad: [
            { x: 0, y: 0 }, { x: stage.source.width, y: 0 }, { x: stage.source.width, y: stage.source.height }, { x: 0, y: stage.source.height },
          ] })}
        />
      )}

      {stage.kind === "live" && (
        <LiveScanner
          pageCount={pages.length}
          lastThumb={pages[pages.length - 1]?.url ?? null}
          onCapture={onLiveCapture}
          onDone={onLiveDone}
          onFallback={onLiveFallback}
        />
      )}

      {stage.kind === "pages" && (
        <Pages
          pages={pages}
          mode={mode}
          onMode={(m) => void switchMode(m)}
          onRemove={removePage}
          onAdjust={(id) => void adjustPage(id)}
          onAdd={openCamera}
          onCheck={() => void check()}
          reading={background?.key === pages ? (background.done ? "done" : "running") : null}
        />
      )}

      {stage.kind === "checking" && <Busy text="يقرأ النظام الفاتورة ليتأكد أنها واضحة…" startedAt={stage.startedAt} />}

      {stage.kind === "checked" && (
        <Checked
          result={stage.result}
          pages={pages}
          note={note}
          onNote={setNote}
          onSend={() => void send()}
          onRetake={() => {
            /* مسحٌ جاهز: يُعاد من البداية (ماسحُ الجوال أو ملفٌّ آخر) */
            if (pages.length === 0) { startOver(); return; }
            /* الحكمُ القديم لا يبقى على صفحاتٍ تغيّرت — يعود إلى الصفحات أو البداية */
            const last = pages[pages.length - 1];
            if (last) removePage(last.id);
            setStage({ kind: pages.length > 1 ? "pages" : "home" });
            openCamera();
          }}
          onRecheck={() => { reading.current = null; void check(); }}
          onDone={startOver}
        />
      )}

      {stage.kind === "sending" && <Busy text="يرسل…" />}

      {stage.kind === "sent" && (
        <section className="mt-10 flex flex-col items-center text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-ok-bg text-ok">
            <CircleCheck className="h-9 w-9" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-bold">{stage.duplicate ? "وصلت هذه الفاتورة من قبل" : "وصلت الفاتورة"}</h1>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-ink-soft">
            {stage.duplicate ? "لا حاجة لإرسالها مرة أخرى." : "سيراجعها المدير ويعتمدها. احتفظ بالورقة في مكانها المعتاد."}
          </p>
          <button type="button" onClick={() => { setStage({ kind: "home" }); openCamera(); }} className={`${buttonClass("primary", "lg")} mt-8 w-full`}>
            <Camera className="h-5 w-5" aria-hidden /> صوّر فاتورة أخرى
          </button>
          <button type="button" onClick={() => setStage({ kind: "home" })} className={`${buttonClass("quiet", "md")} mt-2`}>
            ما أرسلته
          </button>
        </section>
      )}
    </main>
  );
}

/* ─────────────────────── الأجزاء ─────────────────────── */

function Busy({ text, startedAt }: { text: string; startedAt?: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return (
    <section className="mt-16 flex flex-col items-center text-center" aria-live="polite">
      <ScanLine className="h-10 w-10 animate-pulse text-accent motion-reduce:animate-none" aria-hidden />
      <p className="mt-4 text-sm font-bold">{text}</p>
      {startedAt && (
        <p className="mt-1 text-xs text-muted">
          <span className="nums">{seconds.toLocaleString("ar-SA")}</span> ثانية{seconds > 20 ? " — قد تأخذ نصف دقيقة" : ""}
        </p>
      )}
    </section>
  );
}

const STATUS: Record<SentItem["status"], { text: string; tone: string; Icon: typeof Clock }> = {
  PENDING: { text: "تنتظر المراجعة", tone: "text-muted", Icon: Clock },
  ARCHIVED: { text: "اعتُمدت", tone: "text-ok", Icon: CircleCheck },
  REJECTED: { text: "رُفضت", tone: "text-danger", Icon: CircleAlert },
};

function Home({ onCamera, onLive, onGallery, onReady, recent }: { onCamera: () => void; onLive?: () => void; onGallery: () => void; onReady: () => void; recent: SentItem[] }) {
  return (
    <>
      <section className="mt-6 rounded-2xl border border-line bg-raised p-5 shadow-raised">
        <button type="button" onClick={onCamera} className={`${buttonClass("primary", "lg")} min-h-16 w-full text-base`}>
          <Camera className="h-6 w-6" aria-hidden /> صوّر الفاتورة
        </button>
        <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-ink-soft">
          <li>• صوّرها من فوقها مباشرة، والورقة كلها في الإطار بلا ظل يدك عليها.</li>
          <li>• يحدّد النظام حدودها ويقوّمها وحده، وتعدّل الزوايا بإصبعك إن لزم.</li>
          <li>• إن كانت أكثر من صفحة فأضف التالية بعدها، ثم افحص الوضوح وأرسل.</li>
        </ul>
        <div className="mt-3 grid gap-1">
          {onLive && (
            <button type="button" onClick={onLive} className={`${buttonClass("quiet", "sm")} w-full`}>
              <ScanLine className="h-4 w-4" aria-hidden /> أو الماسح الحيّ (الكاميرا داخل الصفحة)
            </button>
          )}
          <button type="button" onClick={onGallery} className={`${buttonClass("quiet", "sm")} w-full`}>
            <ImagePlus className="h-4 w-4" aria-hidden /> أو اختر صورة من الجوال
          </button>
        </div>
      </section>

      {/*
        ماسحُ الجوال نفسه أوضحُ ما يكون (أبل تعالج الصورةَ بما لا تصله صفحةُ ويب). فطريقٌ
        ثانٍ: يمسح بماسح الآيفون ثمّ يختار الملفّ هنا — ويُرسل كما هو.
      */}
      <section className="mt-4 rounded-2xl border border-line bg-raised p-5 shadow-raised">
        <p className="text-sm font-bold">أوضح صورة: ماسح الآيفون نفسه</p>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-xs leading-relaxed text-ink-soft">
          <li>افتح تطبيق «الملفات»، ثم «تصفح»، ثم النقاط الثلاث أعلى الشاشة، ثم «مسح المستندات».</li>
          <li>امسح الفاتورة (يلتقطها وحده)، ثم «حفظ» واحفظها في الملفات.</li>
          <li>ارجع هنا واضغط الزر، ثم اختر الملف.</li>
        </ol>
        <button type="button" onClick={onReady} className={`${buttonClass("secondary", "md")} mt-3 w-full`}>
          <FileText className="h-4 w-4" aria-hidden /> ارفع ملفاً ممسوحاً
        </button>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-bold">ما أرسلته</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-xs text-muted">لم ترسل شيئاً بعد.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised">
            {recent.map((r) => {
              const s = STATUS[r.status];
              return (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                  <s.Icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.tone}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className={`font-bold ${s.tone}`}>{s.text}</span>
                      <span className="text-muted"> · {timeAgo(r.createdAt)}</span>
                    </p>
                    {r.status === "REJECTED" && r.decisionNote && (
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">السبب: {r.decisionNote}</p>
                    )}
                    {r.note && <p className="mt-0.5 truncate text-xs text-muted">ملاحظتك: {r.note}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * زوايا الورقة الأربع — تُسحب بالإصبع. المقبضُ واسعٌ للّمس (٤٤ بكسلاً)
 * ونقطتُه في وسطه، والأضلاعُ ترسم الورقة كما ستُقصّ.
 */
function Adjust({
  stage, onChange, onDone, onRetake, onFull,
}: {
  stage: Extract<Stage, { kind: "adjust" }>;
  onChange: (q: Quad) => void;
  onDone: () => void;
  onRetake: () => void;
  onFull: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const { source, url, quad } = stage;

  const toSource = (e: React.PointerEvent): Point | null => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.min(source.width, Math.max(0, ((e.clientX - r.left) / r.width) * source.width)),
      y: Math.min(source.height, Math.max(0, ((e.clientY - r.top) / r.height) * source.height)),
    };
  };

  const move = (e: React.PointerEvent) => {
    if (drag.current === null) return;
    const p = toSource(e);
    if (!p) return;
    const i = drag.current;
    onChange([i === 0 ? p : quad[0], i === 1 ? p : quad[1], i === 2 ? p : quad[2], i === 3 ? p : quad[3]]);
  };

  const end = () => {
    if (drag.current === null) return;
    drag.current = null;
    /* زاويةٌ سُحبت إلى غير موضعها تُعاد إلى ترتيبها — فلا تنقلب الورقة */
    onChange(orderQuad(quad));
  };

  const pct = (p: Point) => ({ left: `${(p.x / source.width) * 100}%`, top: `${(p.y / source.height) * 100}%` });
  const poly = quad.map((p) => `${(p.x / source.width) * 100},${(p.y / source.height) * 100}`).join(" ");

  return (
    <section className="mt-3 flex flex-1 flex-col">
      <p className="text-sm font-bold">{stage.detected ? "هذه حدود الورقة" : "حدّد حدود الورقة"}</p>
      <p className="text-xs text-muted">
        {stage.detected ? "اسحب أي زاوية إن لم تكن على طرف الورقة." : "لم يجد النظام حواف الورقة. اسحب الزوايا الأربع إلى أطرافها."}
      </p>
      <div
        ref={box}
        className="relative mx-auto mt-3 w-full touch-none select-none overflow-hidden rounded-xl bg-sunken"
        style={{ aspectRatio: `${source.width} / ${source.height}`, maxHeight: "62dvh", maxWidth: `calc(62dvh * ${source.width / source.height})` }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ للصورة الملتقطة */}
        <img src={url} alt="الصورة الملتقطة" className="absolute inset-0 h-full w-full" draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <polygon points={poly} fill="rgb(90 84 68 / 0.18)" stroke="#fff" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        </svg>
        {quad.map((p, i) => (
          <button
            key={i}
            type="button"
            aria-label={`زاوية ${i + 1}`}
            className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full"
            style={pct(p)}
            onPointerDown={(e) => { drag.current = i; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
          >
            <span className="h-5 w-5 rounded-full border-[3px] border-white bg-accent shadow-[0_0_0_1px_rgb(0_0_0/0.3)]" />
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onRetake} className={buttonClass("secondary", "md")}>
          <RotateCcw className="h-4 w-4" aria-hidden /> أعد التصوير
        </button>
        <button type="button" onClick={onFull} className={buttonClass("quiet", "md")}>الصورة كلها</button>
      </div>
      <button type="button" onClick={onDone} className={`${buttonClass("primary", "lg")} mt-2 w-full`}>
        <Check className="h-5 w-5" aria-hidden /> تم
      </button>
    </section>
  );
}

function Pages({
  pages, mode, onMode, onRemove, onAdjust, onAdd, onCheck, reading,
}: {
  pages: ScanPage[];
  mode: ScanMode;
  onMode: (m: ScanMode) => void;
  onRemove: (id: string) => void;
  onAdjust: (id: string) => void;
  onAdd: () => void;
  onCheck: () => void;
  /** القراءةُ في الخلفية لهذه الصفحات: جارية · انتهت · لم تبدأ */
  reading: "running" | "done" | null;
}) {
  const issues = [...new Set(pages.flatMap((p) => p.issues))];
  return (
    <section className="mt-3 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{countNoun(pages.length, PAGE)}</p>
        <div role="radiogroup" aria-label="شكل الصورة" className="inline-flex rounded-lg border border-line bg-raised p-0.5 text-xs">
          {([["document", "مستند", FileText], ["color", "ألوان", Palette]] as const).map(([m, text, Icon]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => onMode(m)}
              className={`inline-flex min-h-9 items-center gap-1 rounded-md px-3 font-bold ${mode === m ? "bg-accent text-accent-ink" : "text-ink-soft"}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {text}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-3 space-y-3">
        {pages.map((p, i) => (
          <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
            {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ للصفحة الممسوحة */}
            <img src={p.url} alt={`الصفحة ${i + 1}`} className="block max-h-[55dvh] w-full bg-white object-contain" />
            {/* الحذفُ تحت الصفحة لا فوقها — كان يغطّي أوّلَ سطرٍ منها */}
            <div className="flex items-center justify-between border-t border-line-soft px-3 py-1">
              <span className="text-xs text-muted">الصفحة {(i + 1).toLocaleString("ar-SA")}</span>
              <span className="flex gap-1">
                <button type="button" onClick={() => onAdjust(p.id)} className={buttonClass("quiet", "sm")}>
                  <Crop className="h-3.5 w-3.5" aria-hidden /> عدّل الحدود
                </button>
                <button type="button" onClick={() => onRemove(p.id)} className={buttonClass("quiet", "sm")}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> احذفها
                </button>
              </span>
            </div>
          </li>
        ))}
      </ul>

      {issues.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-xl border border-warn/30 bg-warn-bg px-3 py-2.5">
          {issues.map((k) => (
            <li key={k} className="flex items-start gap-2 text-xs leading-relaxed text-warn">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {QUALITY_MESSAGE[k]}
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={onAdd} className={`${buttonClass("secondary", "md")} mt-3 w-full`}>
        <Plus className="h-4 w-4" aria-hidden /> أضف صفحة أخرى من الفاتورة نفسها
      </button>
      <div className="mt-2">
        <CheckButton onClick={onCheck} reading={reading} />
      </div>
    </section>
  );
}

/** «افحص الوضوح» — ويقول إن كانت القراءةُ قد بدأت في الخلفية أو انتهت. */
function CheckButton({ onClick, reading }: { onClick: () => void; reading: "running" | "done" | null }) {
  return (
    <>
      <button type="button" onClick={onClick} className={`${buttonClass("primary", "lg")} w-full`}>
        {reading === "done"
          ? <><CircleCheck className="h-5 w-5" aria-hidden /> اعرض ما قرأه النظام</>
          : <><ScanLine className="h-5 w-5" aria-hidden /> افحص الوضوح</>}
      </button>
      <p className="mt-2 flex min-h-5 items-center justify-center gap-1.5 text-xs text-muted" aria-live="polite">
        {reading === "running" && <><Clock className="h-3.5 w-3.5" aria-hidden /> بدأ النظام يقرأ الفاتورة…</>}
        {reading === "done" && <><Check className="h-3.5 w-3.5" aria-hidden /> قُرئت الفاتورة، والنتيجة جاهزة</>}
      </p>
    </>
  );
}

function ReadRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`min-w-0 truncate text-sm font-bold ${value ? "" : "text-danger"}`} dir="auto">
        {value ?? "لم يُقرأ"}
      </dd>
    </div>
  );
}

function Checked({
  result, pages, note, onNote, onSend, onRetake, onRecheck, onDone,
}: {
  result: Check;
  pages: ScanPage[];
  note: string;
  onNote: (s: string) => void;
  onSend: () => void;
  onRetake: () => void;
  onRecheck: () => void;
  onDone: () => void;
}) {
  if (result.kind === "duplicate") {
    return (
      <section className="mt-10 text-center">
        <CircleCheck className="mx-auto h-10 w-10 text-ok" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">وصلت هذه الفاتورة من قبل</h1>
        <p className="mt-1 text-sm text-ink-soft">{result.where === "DOCUMENT" ? "وهي مسجّلة في النظام." : "وهي تنتظر المراجعة."} لا حاجة لإرسالها.</p>
        <button type="button" onClick={onDone} className={`${buttonClass("primary", "lg")} mt-6 w-full`}>تم</button>
      </section>
    );
  }

  const clear = result.kind === "verdict" && result.verdict.level === "CLEAR";
  const v = result.kind === "verdict" ? result.verdict : null;

  return (
    <section className="mt-3 flex flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ للصفحة الممسوحة */}
      {pages[0] && <img src={pages[0].url} alt="الفاتورة الممسوحة" className="mx-auto max-h-[28dvh] rounded-lg border border-line object-contain" />}

      <div className={`mt-4 rounded-xl border px-4 py-3 ${clear ? "border-ok/30 bg-ok-bg" : "border-warn/30 bg-warn-bg"}`}>
        <p className={`flex items-center gap-2 text-base font-bold ${clear ? "text-ok" : "text-warn"}`}>
          {clear ? <CircleCheck className="h-5 w-5" aria-hidden /> : <CircleAlert className="h-5 w-5" aria-hidden />}
          {clear ? "واضحة، وقُرئت" : v?.level === "UNREADABLE" ? "لم تُقرأ الفاتورة" : result.kind === "verdict" ? "بعضها لم يُقرأ" : result.kind === "outage" ? "لم تُفحص الآن" : "لم تُفحص"}
        </p>
        {v && v.missing.length > 0 && (
          <p className="mt-1 text-xs leading-relaxed text-warn">
            لم يُقرأ: {v.missing.join("، ")}. صوّرها مرة أخرى أقرب وفي ضوء أفضل.
          </p>
        )}
        {(result.kind === "outage" || result.kind === "failed") && (
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">{result.message}</p>
        )}
        {v && (
          <dl className="mt-2 divide-y divide-line-soft">
            <ReadRow label="المورّد" value={v.read.supplier} />
            <ReadRow label="رقم الفاتورة" value={v.read.invoiceNumber} />
            <ReadRow label="التاريخ" value={v.read.invoiceDate} />
            <ReadRow label="الإجمالي" value={v.read.total ? `${v.read.total} ريال` : null} />
          </dl>
        )}
        {v && v.level !== "UNREADABLE" && <p className="mt-2 text-[11px] text-muted">قارن ما قُرئ بالورقة في يدك.</p>}
      </div>

      <label className="mt-4 block text-xs font-bold" htmlFor="capture-note">ملاحظة للمدير (اختياري)</label>
      <textarea
        id="capture-note"
        value={note}
        onChange={(e) => onNote(e.target.value.slice(0, 300))}
        rows={2}
        placeholder="مثلاً: المندوب ينتظر الدفع، أو البضاعة ناقصة كرتون"
        className="mt-1 w-full rounded-lg border border-line-input bg-raised px-3 py-2 text-sm"
      />

      {clear ? (
        <button type="button" onClick={onSend} className={`${buttonClass("primary", "lg")} mt-4 w-full`}>
          <Send className="h-5 w-5" aria-hidden /> أرسل
        </button>
      ) : (
        <>
          {result.kind === "failed" ? (
            <button type="button" onClick={onRecheck} className={`${buttonClass("primary", "lg")} mt-4 w-full`}>
              <RotateCcw className="h-5 w-5" aria-hidden /> أعد الفحص
            </button>
          ) : (
            <button type="button" onClick={onRetake} className={`${buttonClass(result.kind === "outage" ? "secondary" : "primary", "lg")} mt-4 w-full`}>
              <Camera className="h-5 w-5" aria-hidden /> أعد تصوير {pages.length > 1 ? "آخر صفحة" : "الفاتورة"}
            </button>
          )}
          <button type="button" onClick={onSend} className={`${buttonClass(result.kind === "outage" ? "primary" : "quiet", "md")} mt-2 w-full`}>
            <Send className="h-4 w-4" aria-hidden /> أرسلها كما هي
          </button>
        </>
      )}
    </section>
  );
}
