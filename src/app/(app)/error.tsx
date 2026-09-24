"use client";

import Link from "next/link";
import { useEffect } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { buttonClass } from "@/components/ui-tokens";

/**
 * حدُّ الخطأ — بالعربية، داخل القشرة.
 *
 * انقطاعٌ في الاتصال بالقاعدة كان يعرض صفحة Next الافتراضيّة بالإنجليزيّة،
 * وصاحبُ العمل لا يعرف أهو عطبٌ عابر أم فُقد شيء. وعرضُ الصفحة قراءةٌ لا
 * كتابة، فيُقال ذلك صراحةً — ومعه طريقان: أعد المحاولة، أو ارجع إلى اليوم.
 */
export default function ErrorPage({
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
    <main id="main" className="mx-auto max-w-lg px-4 py-16 sm:py-24">
      <title>تعذّر عرض الصفحة · ذا بوبليك هاوس</title>
      <div className="rounded-2xl border border-line bg-raised px-6 py-10 text-center shadow-lifted">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-bg text-danger">
          <CloudOff className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-bold">تعذّر عرض هذه الصفحة</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          عرضُ الصفحة لا يكتب شيئاً، فلم يضِع قيد. وغالباً هو انقطاعٌ عابر في الاتصال بالقاعدة —
          أعد المحاولة بعد لحظة.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-muted">
            إن تكرّر فانقل هذا الرمز لمن يصلحه: <span className="nums" dir="ltr">{error.digest}</span>
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
            <RotateCw className="h-4 w-4" strokeWidth={2} aria-hidden />
            أعد المحاولة
          </button>
          <Link href="/" className={buttonClass("secondary")}>
            إلى اليوم
          </Link>
        </div>
      </div>
    </main>
  );
}
