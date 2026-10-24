"use client";

import { useEffect, useState } from "react";
import { RotateCw, ZoomIn, ZoomOut } from "lucide-react";

/*
  الورقةُ معروضةً — صورةٌ بتكبيرٍ وتدوير، وPDF في إطار. كانت في شاشة الرفع وحدها،
  ونُقلت لتُعرَض بها ورقةُ المستند المؤرشف أيضاً (`document-paper.tsx`): عارضٌ واحد.
*/

/**
 * صورةُ الورقة بتكبيرٍ وتدوير — رقمٌ صغير في فاتورةٍ صُوّرت مائلةً يُقرأ هنا لا
 * في تطبيقٍ آخر. التكبيرُ عرضٌ داخل إطارٍ يُمرَّر (ويبقى القرصُ بإصبعين)، والتدويرُ
 * يرسم نسخةً مُدارةً محلّياً: **للعرض وحده** — الملفُّ الذي يُؤرشَف هو الأصل كما رُفع.
 */
function ImagePaper({ url, name }: { url: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  const [turned, setTurned] = useState<{ url: string; quarter: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (turned) URL.revokeObjectURL(turned.url); }, [turned]);

  async function rotate() {
    if (busy) return;
    const quarter = ((turned?.quarter ?? 0) + 1) % 4;
    if (quarter === 0) { setTurned(null); return; }
    setBusy(true);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const swap = quarter % 2 === 1;
      const canvas = document.createElement("canvas");
      canvas.width = swap ? img.naturalHeight : img.naturalWidth;
      canvas.height = swap ? img.naturalWidth : img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((quarter * Math.PI) / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (blob) setTurned({ url: URL.createObjectURL(blob), quarter });
    } catch {
      /* صورةٌ لا يفكّها المتصفّح (HEIC في كروم) — تبقى كما هي */
    } finally {
      setBusy(false);
    }
  }

  const tool = "grid h-11 w-11 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-hover hover:text-ink disabled:opacity-40 sm:h-8 sm:w-8";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-end gap-0.5" role="group" aria-label="اعرض الورقة">
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} disabled={zoom <= 1} aria-label="صغّر الورقة" className={tool}>
          <ZoomOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
        <span className="nums nums-count w-10 text-center text-[11px] text-muted" dir="ltr" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} disabled={zoom >= 4} aria-label="كبّر الورقة" className={tool}>
          <ZoomIn className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
        <button type="button" onClick={() => void rotate()} aria-busy={busy} aria-label="أدر الورقة ربع دورة" className={tool}>
          <RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-auto overscroll-contain rounded-lg [touch-action:pan-x_pan-y_pinch-zoom]">
        {/* eslint-disable-next-line @next/next/no-img-element -- رابطٌ محلّيّ (blob:) لا يمرّ بمحسِّن الصور */}
        <img
          src={turned?.url ?? url}
          alt={`الورقة: ${name}`}
          style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }}
          className={zoom === 1 ? "mx-auto max-h-[70vh] w-full rounded-lg object-contain" : "block rounded-lg"}
        />
      </div>
    </div>
  );
}

/**
 * الـPDF في إطار — من نسخةٍ محلّيّة (`blob:`) دائماً.
 *
 * صورةُ الفريق المفتوحة بمعرّفها رابطُها رابطُ الخادم (`/api/capture/file`)، والخادمُ يمنع
 * تضمينَ أيّ ردٍّ منه في إطار (`X-Frame-Options: DENY` في `next.config.ts` — حمايةٌ لا تُرخى)،
 * فظهر «رفض الاتصال» مكانَ الورقة. فيُجلب الملفُّ ويُعرض من نسخته المحلّيّة كما كان قبلها.
 */
function PdfPaper({ url, name }: { url: string; name: string }) {
  const local = url.startsWith("blob:");
  const [fetched, setFetched] = useState<{ from: string; blob: string | null } | null>(null);
  useEffect(() => {
    if (local) return;
    let alive = true;
    let made: string | null = null;
    fetch(url)
      .then((res) => (res.ok ? res.blob() : null))
      .then((b) => {
        if (!alive) return;
        made = b ? URL.createObjectURL(b) : null;
        setFetched({ from: url, blob: made });
      })
      .catch(() => { if (alive) setFetched({ from: url, blob: null }); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [url, local]);
  const src = local ? url : fetched?.from === url ? fetched.blob : undefined;
  if (src === undefined) return <p className="p-4 text-xs text-muted">يجهّز الورقة…</p>;
  if (src === null) return <p className="p-4 text-xs text-danger">تعذّر عرض الورقة. أعد فتح البطاقة.</p>;
  /* `iframe` لا `object`: سياسةُ المحتوى تمنع `object-src` كلَّه (`next.config.ts`) */
  return <iframe src={src} title={`الورقة: ${name}`} className="h-[70vh] w-full rounded-lg border-0 bg-raised" />;
}

/** الورقةُ بجانب القراءة — صورةٌ تُعرَض بتكبيرٍ وتدوير، وPDF يُضمَّن في إطار. */
export function Paper({ url, mime, name }: { url: string; mime: string; name: string }) {
  if (mime.startsWith("image/")) return <ImagePaper url={url} name={name} />;
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return <PdfPaper url={url} name={name} />;
  return <p className="p-4 text-xs text-muted">لا معاينة لهذا النوع.</p>;
}
