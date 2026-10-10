"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Sheet, toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { SESSION_EXPIRED_EVENT } from "@/lib/http-client";

/**
 * عينُ القشرة على حالين لا تراهما الصفحةُ المرسومة في الخادم:
 *
 * **انتهت الجلسة** — أيُّ طلبٍ ردّ 401 يفتح ورقة «ادخل ثانيةً»: الدخولُ في لسانٍ
 * آخر (الجلسةُ كعكةٌ يقرؤها هذا اللسانُ كذلك)، فيبقى ما كُتب هنا ويُعاد الطلب.
 * كان الخبرُ سطراً أحمر تحت الزرّ ولا طريق.
 *
 * **عاد بعد غياب** — التطبيقُ المثبَّت بلا زرّ تحديث، ومن فتحه صباحاً وعاد إليه
 * مساءً رأى أرقامَ الصباح. فعند عودة الظهور بعد خمس دقائق تُحدَّث الصفحة ويُقال
 * ذلك — إلّا إن كان يكتب في حقل، فيُنتظَر خروجُه منه.
 */
const STALE_AFTER_MS = 5 * 60_000;

function typing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file"].includes(el.type);
}

export function ShellWatch() {
  const router = useRouter();
  const pathname = usePathname();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const onExpired = () => setExpired(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away < STALE_AFTER_MS) return;
      /* من يكتب لا تُحدَّث صفحتُه تحت يده — يُقال له ويحدّث متى شاء */
      if (typing() || document.querySelector("dialog[open]")) {
        toast({ tone: "info", title: "الأرقامُ قد تكون قديمة", body: "غبتَ عن الصفحة مدّة — حدّثها حين تفرغ ممّا تكتب." });
        return;
      }
      router.refresh();
      toast({ tone: "info", title: "حُدّثت الصفحة الآن", body: "عدتَ بعد غياب، فأُعيد جلبُ الأرقام.", duration: 3500 });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router]);

  return (
    <Sheet
      open={expired}
      onClose={() => setExpired(false)}
      title="انتهت جلستك"
      description="ما كتبتَه في هذه الصفحة باقٍ — لم يُحفَظ بعد."
      size="sm"
      footer={
        <>
          <button type="button" className={buttonClass("quiet")} onClick={() => setExpired(false)}>أغلق</button>
          <a
            href={`/login?from=${encodeURIComponent(pathname)}`}
            target="_blank"
            rel="noopener"
            className={buttonClass("primary")}
            onClick={() => setExpired(false)}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={2} aria-hidden />
            ادخل ثانيةً في لسانٍ جديد
          </a>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        ادخل بحسابك في لسانٍ جديد، ثمّ عُد إلى هذا اللسان وأعِد ما كنتَ تفعله — الصفحةُ هنا كما تركتَها.
        وإن أغلقتَ هذه الورقة فلن يُحفَظ شيءٌ حتى تدخل.
      </p>
    </Sheet>
  );
}
