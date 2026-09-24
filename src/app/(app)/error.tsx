"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * حدُّ الخطأ — بالعربية.
 *
 * كان انقطاعُ Neon في أيّ صفحة يعرض صفحة Next الافتراضيّة بالإنجليزيّة،
 * وصاحبُ العمل لا يعرف أهو عطبٌ عابر أم فُقد شيء. وعرضُ الصفحة قراءةٌ لا
 * كتابة، فيُقال ذلك صراحةً.
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
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-2xl border border-danger/40 bg-danger-bg px-5 py-8 text-center">
        <h1 className="text-lg font-bold text-danger">تعذّر عرض هذه الصفحة</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          عرضُ الصفحة لا يكتب شيئاً، فلم يضِع قيد. وغالباً هو انقطاعٌ عابر في الاتصال بالقاعدة —
          أعد المحاولة بعد لحظة.
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-muted">
            إن تكرّر فانقل هذا الرمز لمن يصلحه: <span className="nums" dir="ltr">{error.digest}</span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center rounded-lg bg-inverse-surface px-4 text-sm font-bold text-inverse-ink sm:min-h-9"
          >
            أعد المحاولة
          </button>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm sm:min-h-9"
          >
            الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}
