"use client";

import { useEffect } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { InspectorPanel } from "@/components/inspector";
import { buttonClass } from "@/components/ui-tokens";
import { T } from "@/components/i18n/t";

/**
 * خطأٌ في لوح الفحص يبقى **في اللوح**.
 *
 * كان فشلُ تحميل ملفِّ مورّدٍ (انقطاعُ القاعدة لحظةً) يصعد إلى حدّ الصفحة فيُسقط
 * القائمةَ التي تحته بتمريرها وتصفيتها. فهنا يُرسَم اللوحُ نفسُه بالخبر وزرِّ
 * إعادة، والقائمةُ كما تُركت. وعرضُ الملفّ قراءةٌ لا كتابة — لم يضِع قيد.
 */
export default function DrawerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <InspectorPanel title="تعذّر فتح الملف">
      <div className="rounded-2xl border border-line bg-raised px-6 py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-bg text-danger">
          <CloudOff className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <p role="alert" className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-ink-soft">
          فتح الملف لا يغيّر أي بيانات، فلم يضِع شيء. السبب غالباً انقطاع مؤقت في الاتصال بقاعدة البيانات. أعد المحاولة بعد لحظة، والقائمة خلفه كما هي.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-muted">
            <T s="إن تكرر الخطأ فأرسل هذا الرمز للدعم الفني: {0}" a={[<span key="0" className="nums nums-count" dir="ltr">{error.digest}</span>]} /></p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
            <T s="{0}أعد المحاولة" a={[<RotateCw key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></button>
        </div>
      </div>
    </InspectorPanel>
  );
}
