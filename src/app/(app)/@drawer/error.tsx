"use client";

import { useEffect } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { InspectorPanel } from "@/components/inspector";
import { buttonClass } from "@/components/ui-tokens";

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
    <InspectorPanel title="تعذّر فتح هذا الملفّ">
      <div className="rounded-2xl border border-line bg-raised px-6 py-10 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-bg text-danger">
          <CloudOff className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <p role="alert" className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-ink-soft">
          فتحُ الملفّ لا يكتب شيئاً، فلم يضِع قيد. وغالباً هو انقطاعٌ عابر في الاتّصال بالقاعدة —
          أعد المحاولة بعد لحظة، والقائمةُ تحته كما تركتَها.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-muted">
            إن تكرّر فانقل هذا الرمز لمن يصلحه: <span className="nums nums-count" dir="ltr">{error.digest}</span>
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
            <RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden />
            أعد المحاولة
          </button>
        </div>
      </div>
    </InspectorPanel>
  );
}
