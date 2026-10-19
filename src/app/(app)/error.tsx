"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CloudOff, RotateCw, WifiOff } from "lucide-react";
import { buttonClass } from "@/components/ui-tokens";
import { T } from "@/components/i18n/t";

/**
 * حدُّ الخطأ — بالعربية، داخل القشرة.
 *
 * انقطاعٌ في الاتصال بالقاعدة كان يعرض صفحة Next الافتراضيّة بالإنجليزيّة،
 * وصاحبُ العمل لا يعرف أهو عطبٌ عابر أم فُقد شيء. وعرضُ الصفحة قراءةٌ لا
 * كتابة، فيُقال ذلك صراحةً — ومعه طريقان: أعد المحاولة، أو ارجع إلى اليوم.
 */
const AUTO_RETRY_SECONDS = 3;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

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

  /* أمقطوعٌ الجهازُ أم الخادمُ لم يردّ؟ — الجوابان يختلفان، فتختلف الجملة */
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  /*
    محاولةٌ واحدة تلقائيّة: حين يعود الاتّصال، أو بعد لحظةٍ إن كان الجهازُ موصولاً
    (انقطاعُ القاعدة العابر يزول بثوانٍ). واحدةٌ لا حلقة — وما بعدها بالزرّ.
  */
  const tried = useRef(false);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!online || tried.current) return;
    tried.current = true;
    let n = AUTO_RETRY_SECONDS;
    const tick = window.setInterval(() => {
      n -= 1;
      if (n <= 0) {
        window.clearInterval(tick);
        setLeft(null);
        retry();
      } else {
        setLeft(n);
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [online, retry]);

  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16 sm:py-24">
      <title>تعذّر عرض الصفحة · ذا بوبليك هاوس</title>
      <div className="rounded-2xl border border-line bg-raised px-6 py-10 text-center shadow-lifted">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-danger-bg text-danger">
          {online ? <CloudOff className="h-6 w-6" strokeWidth={1.75} aria-hidden /> : <WifiOff className="h-6 w-6" strokeWidth={1.75} aria-hidden />}
        </span>
        <h1 className="mt-4 text-lg font-bold">{online ? "تعذّر عرض هذه الصفحة" : "لا يوجد اتصال بالإنترنت"}</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          {online
            ? "عرض الصفحة لا يغيّر أي بيانات، فلم يضِع شيء. لم يستجب الخادم، والسبب غالباً انقطاع مؤقت في الاتصال بقاعدة البيانات."
            : "جهازك غير متصل بالإنترنت. عرض الصفحة لا يغيّر أي بيانات، فلم يضِع شيء، وستُعاد المحاولة تلقائياً عند عودة الاتصال."}
        </p>
        <p className="mt-2 min-h-5 text-xs font-bold text-ink-soft" role="status">
          {left !== null && <><T s="إعادة المحاولة بعد {0} ث…" a={[<span key="0" className="nums">{left}</span>]} /></>}
        </p>
        {error.digest && (
          <p className="mt-3 text-[11px] text-muted">
            <T s="إن تكرر الخطأ فأرسل هذا الرمز للدعم الفني: {0}" a={[<span key="0" className="nums" dir="ltr">{error.digest}</span>]} /></p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
            <T s="{0}أعد المحاولة" a={[<RotateCw key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></button>
          <Link href="/" className={buttonClass("secondary")}>
            حتى اليوم
          </Link>
        </div>
      </div>
    </main>
  );
}
