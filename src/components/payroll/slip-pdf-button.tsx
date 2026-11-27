"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Eye, FileText, MessageCircle, Send } from "lucide-react";
import { buttonClass } from "../ui-tokens";
import { NETWORK_ERROR, readResponse } from "@/lib/http-client";
import { whatsappLink } from "@/lib/whatsapp";

function subscribePointer(cb: () => void): () => void {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * قسيمةُ الراتب PDF للموظّف.
 *
 * - **الحاسوب** (واتساب مفتوحٌ عند أحمد في اللابتوب): ضغطةٌ واحدة «أرسل واتساب» تنزّل الملفّ وتفتح محادثةَ
 *   الموظّف برقمه المكتوب في صفحته ورسالةٍ جاهزة — يُسحب الملفُّ إليها. روابطُ واتساب لا تحمل ملفّاً.
 *   ونافذةُ واتساب تُفتح لحظةَ الضغط ثمّ يُوجَّه إليها، وإلّا منعها المتصفّحُ بعد انتظار الملفّ.
 * - **الجوّال**: خطوتان لأنّ المشاركةَ لا تقبل ملفّاً إلّا من ضغطةٍ مباشرة: «جهّز» ثمّ «أرسلها» (لوحُ المشاركة).
 */
export function SlipPdfButton({ employeeId, month, name, monthLabel, phone, compact = false }: {
  employeeId: string; month: string; name: string; monthLabel: string; phone?: string | null; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ file: File; url: string } | null>(null);
  const [sent, setSent] = useState(false);
  /* جوّالٌ (لمس) أم حاسوب — يُقرأ من المتصفّح، والخادمُ يرسم الحاسوب */
  const touch = useSyncExternalStore(subscribePointer, () => window.matchMedia("(pointer: coarse)").matches, () => false);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  const fileName = `قسيمة راتب ${name} ${monthLabel}.pdf`;
  const wa = whatsappLink(phone, `السلام عليكم ${name.split(" ")[0]}، مرفقة قسيمة راتب ${monthLabel}.`);

  async function fetchFile(): Promise<{ file: File; url: string } | null> {
    if (file) return file;
    try {
      const res = await fetch(`/payroll/slip/${employeeId}/pdf?month=${month}`, { cache: "no-store" });
      if (!res.ok) { const r = await readResponse(res); setError(r.ok ? "تعذّر تجهيز القسيمة." : r.error); return null; }
      const f = new File([await res.blob()], fileName, { type: "application/pdf" });
      const ready = { file: f, url: URL.createObjectURL(f) };
      setFile(ready);
      return ready;
    } catch {
      setError(NETWORK_ERROR);
      return null;
    }
  }

  function download(f: { file: File; url: string }) {
    const a = document.createElement("a");
    a.href = f.url; a.download = f.file.name; a.click();
  }

  /** الحاسوب: نافذةُ واتساب الآن (من الضغطة نفسها)، ثمّ الملفّ، ثمّ المحادثة. */
  async function sendDesktop() {
    if (busy || !wa) return;
    setError(null);
    const win = window.open("about:blank", "_blank");
    setBusy(true);
    const f = await fetchFile();
    setBusy(false);
    if (!f) { win?.close(); return; }
    download(f);
    if (win) win.location.href = wa; else window.open(wa, "_blank");
    setSent(true);
  }

  async function downloadOnly() {
    if (busy) return;
    setError(null);
    setBusy(true);
    const f = await fetchFile();
    setBusy(false);
    if (f) download(f);
  }

  async function shareMobile() {
    if (!file) return;
    setError(null);
    const data: ShareData = { files: [file.file], title: `قسيمة راتب ${monthLabel}` };
    if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
      try { await navigator.share(data); } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setError("تعذّرت المشاركة. نزّل الملف وأرسله بنفسك.");
      }
      return;
    }
    download(file);
    if (wa) window.open(wa, "_blank");
  }

  const size = compact ? "sm" : "md";
  return (
    /* فوق طبقة رابط الصفّ في جدول المسيّر — وإلّا فتح الضغطُ صفحةَ الموظّف */
    <span className="relative z-10 inline-flex flex-wrap items-center gap-2">
      {touch ? (
        !file ? (
          <button type="button" onClick={() => { setBusy(true); void fetchFile().finally(() => setBusy(false)); }} disabled={busy} aria-busy={busy} className={buttonClass("secondary", size)}>
            <FileText className="h-4 w-4" aria-hidden />{busy ? "يُجهَّز…" : compact ? "PDF" : "جهّز القسيمة PDF"}
          </button>
        ) : (
          <>
            <a href={file.url} target="_blank" rel="noopener" className={buttonClass("quiet", size)}><Eye className="h-4 w-4" aria-hidden />اعرضها</a>
            <button type="button" onClick={() => void shareMobile()} className={buttonClass("primary", size)}>
              <Send className="h-4 w-4" aria-hidden />أرسلها
            </button>
          </>
        )
      ) : (
        <>
          {wa ? (
            <button type="button" onClick={() => void sendDesktop()} disabled={busy} aria-busy={busy} className={buttonClass(sent ? "quiet" : "primary", size)}
              title="ينزّل الملف ويفتح محادثته في واتساب — اسحب الملف إليها">
              <MessageCircle className="h-4 w-4" aria-hidden />{busy ? "يُجهَّز…" : sent ? "أُرسل؟ افتحها ثانية" : "أرسل واتساب"}
            </button>
          ) : (
            <span className="text-[11px] text-muted" title="اكتب رقم جواله في صفحته ← البيانات">بلا رقم جوال</span>
          )}
          {/* تُعرض في تبويبٍ قبل أن تُنزَّل أو تُرسل (أحمد، ٢٧ نوفمبر ٢٠٢٦) — المسارُ يردّها `inline` */}
          <a href={`/payroll/slip/${employeeId}/pdf?month=${month}`} target="_blank" rel="noopener" className={buttonClass("quiet", size)}>
            <Eye className="h-4 w-4" aria-hidden />اعرضها
          </a>
          <button type="button" onClick={() => void downloadOnly()} disabled={busy} className={buttonClass("quiet", size)} aria-label="نزّل القسيمة PDF">
            <Download className="h-4 w-4" aria-hidden />{compact ? "" : "PDF"}
          </button>
        </>
      )}
      {sent && !compact && <span className="basis-full text-[11px] text-muted">نزل الملف وفُتحت محادثته: اسحب «{fileName}» إلى المحادثة وأرسله.</span>}
      {error && <span role="alert" className="basis-full text-xs font-bold text-danger">{error}</span>}
    </span>
  );
}
