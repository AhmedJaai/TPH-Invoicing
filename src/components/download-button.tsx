"use client";

import { useState, type ReactNode } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { NETWORK_ERROR, readResponse } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * تنزيلُ ملفٍّ من واجهتنا — بطلبٍ يُقرأ ردُّه، لا `<a download>` يتولّاه المتصفّح.
 *
 * كان رابطُ التنزيل يحفظ رسالةَ الخطأ ملفّاً («تعذّر تجهيز الحزمة…» صار ‎accountant.xlsx‎ تالفاً)
 * أو يفتح صفحةَ JSON خارج التطبيق، وحزمةُ المحاسب تأخذ دقيقةً بلا «يُجهَّز». فصار: يُطلب، فإن
 * كان خطأً قيل بنصّه، وإلّا نُزّل باسمه من الخادم — وبينهما الزرُّ يقول إنّه يعمل.
 */
export function DownloadButton({ href, fallbackName, children, variant = "secondary", size }: {
  href: string;
  /** اسمُ الملفّ إن لم يسمّه الخادم. */
  fallbackName: string;
  children: ReactNode;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(href, { cache: "no-store" });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || type.includes("application/json") || type.includes("text/html")) {
        const failed = await readResponse(res);
        toast({ tone: "danger", title: "تعذّر التنزيل", body: failed.ok ? "ردّ الخادم بما ليس ملفاً. أعد المحاولة." : failed.error });
        return;
      }
      const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name ? decodeURIComponent(name) : fallbackName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ tone: "danger", title: "تعذّر التنزيل", body: NETWORK_ERROR });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={() => void download()} aria-busy={busy} disabled={busy} className={buttonClass(variant, size)}>
      {busy
        ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
        : <Download className="h-4 w-4" strokeWidth={2} aria-hidden />}
      {busy ? "يُجهَّز الملف…" : children}
    </button>
  );
}
