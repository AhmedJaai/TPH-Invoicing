"use client";

import { useEffect, useState } from "react";
import { Download, FileText, MessageCircle, Send } from "lucide-react";
import { buttonClass } from "../ui-tokens";
import { NETWORK_ERROR, readResponse } from "@/lib/http-client";

/** رقمُ الجوّال لواتساب: «05…» يصير «9665…»، وما لا يُفهم لا يُستعمل. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
  if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `966${d}`;
  if (/^9665\d{8}$/.test(d)) return d;
  if (/^009665\d{8}$/.test(d)) return d.slice(2);
  return null;
}

/**
 * قسيمةُ الراتب PDF للموظّف — خطوتان لأنّ الجوّال لا يشارك ملفّاً إلّا من ضغطةٍ مباشرة:
 * «جهّز PDF» يجلبه من الخادم، ثمّ «أرسله» يفتح لوحَ المشاركة (واتساب وغيره) والملفُّ فيه.
 * ومتصفّحٌ لا يشارك الملفّات (الحاسوب) يُنزّله ويفتح محادثةَ واتساب مع الموظّف ليُرفقه.
 */
export function SlipPdfButton({ employeeId, month, name, monthLabel, phone, compact = false }: {
  employeeId: string; month: string; name: string; monthLabel: string; phone?: string | null; compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ file: File; url: string } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  async function prepare() {
    if (busy) return;
    setBusy(true); setError(null); setFallback(null);
    try {
      const res = await fetch(`/payroll/slip/${employeeId}/pdf?month=${month}`, { cache: "no-store" });
      if (!res.ok) { const r = await readResponse(res); setError(r.ok ? "تعذّر تجهيز القسيمة." : r.error); return; }
      const blob = await res.blob();
      const f = new File([blob], `قسيمة راتب ${name} ${monthLabel}.pdf`, { type: "application/pdf" });
      setFile({ file: f, url: URL.createObjectURL(f) });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!file) return;
    setError(null);
    const data: ShareData = { files: [file.file], title: `قسيمة راتب ${monthLabel}` };
    if (typeof navigator.canShare === "function" && navigator.canShare(data)) {
      try {
        await navigator.share(data);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError("تعذّرت المشاركة. نزّل الملف وأرسله بنفسك.");
      }
      return;
    }
    download();
    const wa = whatsappNumber(phone);
    setFallback(`https://wa.me/${wa ?? ""}?text=${encodeURIComponent(`السلام عليكم ${name.split(" ")[0]}، مرفقة قسيمة راتب ${monthLabel}.`)}`);
  }

  function download() {
    if (!file) return;
    const a = document.createElement("a");
    a.href = file.url; a.download = file.file.name; a.click();
  }

  const size = compact ? "sm" : "md";
  return (
    /* فوق طبقة رابط الصفّ في جدول المسيّر — وإلّا فتح الضغطُ صفحةَ الموظّف */
    <span className="relative z-10 inline-flex flex-wrap items-center gap-2">
      {!file ? (
        <button type="button" onClick={() => void prepare()} disabled={busy} aria-busy={busy} className={buttonClass("secondary", size)}>
          <FileText className="h-4 w-4" aria-hidden />{busy ? "يُجهَّز…" : compact ? "PDF" : "جهّز القسيمة PDF"}
        </button>
      ) : (
        <>
          <button type="button" onClick={() => void send()} className={buttonClass("primary", size)}>
            <Send className="h-4 w-4" aria-hidden />أرسلها{compact ? "" : " للموظف"}
          </button>
          <button type="button" onClick={download} className={buttonClass("quiet", size)} aria-label="نزّل الملف">
            <Download className="h-4 w-4" aria-hidden />{compact ? "" : "نزّل"}
          </button>
          <a href={file.url} target="_blank" rel="noopener" className={buttonClass("quiet", size)}>افتحها</a>
        </>
      )}
      {fallback && (
        <a href={fallback} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", size)}>
          <MessageCircle className="h-4 w-4" aria-hidden />افتح واتساب{whatsappNumber(phone) ? "" : " (لا رقم له)"} وأرفق الملف
        </a>
      )}
      {error && <span role="alert" className="basis-full text-xs font-bold text-danger">{error}</span>}
    </span>
  );
}
