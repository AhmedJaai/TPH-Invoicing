"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Eye, EyeOff, ExternalLink, RotateCw } from "lucide-react";
import { Paper } from "./paper";
import { buttonClass } from "./ui-tokens";
import { NETWORK_ERROR, readResponse } from "@/lib/http-client";
import { driveFileUrl } from "@/lib/document-labels";
import { T } from "@/components/i18n/t";


type Outcome =
  | { phase: "ready"; url: string; mime: string }
  | { phase: "failed"; error: string };
type State = Outcome | { phase: "loading" };

/**
 * ورقةُ المستند داخل التطبيق — تُجلب من الدرايف قراءةً (`/api/document-file`) وتُعرض
 * في مكانها: PDF في إطار، وصورةٌ بتكبيرٍ وتدوير (`paper.tsx`).
 *
 * كان «افتح الملف» يفتح الدرايف في لسانٍ آخر، فمن يقارن القراءةَ بالورقة يقفز بينهما،
 * وعلى الجوّال يخرج من التطبيق. ورابطُ الدرايف باقٍ بجانبها: إن تعذّر العرضُ هنا
 * (تفويضٌ منتهٍ، نوعٌ لا يُعرض، ملفٌّ كبير) قيل السببُ ودُلّ عليه.
 *
 * `defaultOpen`: تُجلب فور الرسم (ملفُّ المستند — الورقةُ موضوعُه). وإلّا فزرٌّ يفتحها:
 * بطاقاتُ المراجعة كثيرة، ولا تُنزَّل أوراقُها كلُّها لأنّ الصفحة فُتحت.
 */
export function DocumentPaper({
  documentId,
  driveFileId,
  fileName,
  defaultOpen = false,
  openLabel = "اعرض الورقة",
}: {
  documentId: string;
  driveFileId: string;
  fileName: string;
  defaultOpen?: boolean;
  openLabel?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [attempt, setAttempt] = useState(0);
  /* النتيجةُ بمفتاح طلبها: ما لم يصل جوابُ هذا المفتاح فهو «يجلب» — بلا حالةٍ تُكتب في الأثر */
  const key = `${documentId}:${attempt}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);
  const state: State = result?.key === key ? result.outcome : { phase: "loading" };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let made: string | null = null;
    const setState = (outcome: Outcome) => setResult({ key, outcome });
    (async () => {
      let res: Response;
      try {
        res = await fetch(`/api/document-file?id=${encodeURIComponent(documentId)}`);
      } catch {
        if (alive) setState({ phase: "failed", error: NETWORK_ERROR });
        return;
      }
      if (!res.ok) {
        const r = await readResponse(res);
        if (alive) setState({ phase: "failed", error: r.ok ? "تعذّر عرض الورقة." : r.error });
        return;
      }
      try {
        const blob = await res.blob();
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setState({ phase: "ready", url: made, mime: blob.type || res.headers.get("content-type") || "" });
      } catch {
        if (alive) setState({ phase: "failed", error: "انقطع جلب الورقة قبل أن يكتمل. أعد المحاولة." });
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [open, documentId, key]);

  const drive = (
    <a href={driveFileUrl(driveFileId)} target="_blank" rel="noreferrer" className={buttonClass("quiet", "sm")}>
      <T s="{0}افتحها في الدرايف" a={[<ExternalLink key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} />
    </a>
  );

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          /* كلُّ فتحٍ طلبٌ جديد: الإغلاقُ أفرغ النسخةَ المحلّيّة (`revokeObjectURL`) */
          onClick={() => { if (!open) setAttempt((n) => n + 1); setOpen(!open); }}
          className={buttonClass(open ? "quiet" : "secondary", "sm")}
        >
          {open
            ? <T s="{0}أخفِ الورقة" a={[<EyeOff key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} />
            : <><Eye className="h-3.5 w-3.5" strokeWidth={2} aria-hidden /><span>{openLabel}</span></>}
        </button>
        {drive}
      </div>

      {open && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-sunken/40 p-2" aria-live="polite" aria-busy={state.phase === "loading"}>
          {state.phase === "loading" ? (
            <div className="grid h-[50vh] place-items-center rounded-lg bg-sunken" role="status">
              <p className="flex items-center gap-2 text-xs text-muted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-e-transparent" aria-hidden />
                يجلب الورقة من الدرايف…
              </p>
            </div>
          ) : state.phase === "failed" ? (
            <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-3 text-xs text-danger">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              <p className="min-w-0 flex-1 font-bold leading-relaxed">{state.error}</p>
              <span className="flex basis-full flex-wrap gap-2 ps-6">
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass("secondary", "sm")}>
                  <T s="{0}أعد المحاولة" a={[<RotateCw key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} />
                </button>
                {drive}
              </span>
            </div>
          ) : (
            <Paper url={state.url} mime={state.mime} name={fileName} />
          )}
        </div>
      )}
    </div>
  );
}
