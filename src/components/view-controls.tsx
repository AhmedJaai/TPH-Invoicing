"use client";

import { useSyncExternalStore } from "react";

/**
 * ضبطُ العرض: الظلامُ، وإخفاءُ الأرقام.
 *
 * كلاهما تفضيلٌ لهذا الجهاز لا بيانٌ ماليّ — فموضعُه `localStorage`، لا
 * القاعدة ولا الجلسة. ولا يُرسَل إلى الخادم شيء: تفضيلُ عرضٍ لا يستحقّ
 * رحلةَ شبكة، ولا يجوز أن يتأخّر عنها.
 *
 * ── ولِمَ يُكتب قبل الرسم ──
 *
 * لو قُرئ التفضيلُ بعد أن تُركَّب الشاشة لومض الأبيضُ لحظةً ثمّ صار
 * أسود، ولَظهرت المبالغُ لحظةً قبل أن تُخفى — وهذا يُبطل الغرضَ من زرّ
 * الإخفاء أصلاً: من يُري شاشتَه لأحد لا ينفعه أن تظهر الأرقام ثلث ثانية.
 *
 * فيُكتب الصنفان على `<html>` بنصٍّ يعمل قبل أوّل رسم (`ThemePrimer`
 * في القشرة)، وهذا المكوّن يقرأ ما كُتب ويبدّله.
 */

const THEME_KEY = "tph.theme";
const AMOUNTS_KEY = "tph.amounts";

type Theme = "light" | "dark" | "system";

/*
  ── الحالةُ تُقرأ من `<html>` لا من متغيّرٍ في React ──

  لأنّ النصّ الذي يسبق الرسمَ كتبها هناك. ولو نُسخت إلى حالةٍ داخليّة
  لصار لها مصدران يفترقان. و`useSyncExternalStore` هي السبيل الذي تُقرأ
  به حالةٌ خارج React بلا مزامنةٍ في أثر.
*/
const EVENT = "tph:view-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    mq.removeEventListener("change", onChange);
  };
}

function announce() {
  window.dispatchEvent(new Event(EVENT));
}

/** أهو داكنٌ الآن؟ — الاختيارُ أوّلاً، ثمّ تفضيلُ الجهاز. */
function darkNow(): boolean {
  const v = document.documentElement.getAttribute("data-theme");
  if (v === "dark") return true;
  if (v === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function hiddenNow(): boolean {
  return document.documentElement.getAttribute("data-amounts") === "hidden";
}

export function ViewControls() {
  /* الخادم لا يعرف تفضيل الجهاز — فيرسم المحايد، ويُصحَّح عند التركيب. */
  const dark = useSyncExternalStore(subscribe, darkNow, () => false);
  const hidden = useSyncExternalStore(subscribe, hiddenNow, () => false);

  function toggleTheme() {
    /* الدورة ثنائيّة لا ثلاثيّة: من ضغط الزرّ يريد الضدّ، لا «اتبع النظام». */
    const next: Theme = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* متصفّحٌ يمنع التخزين — يبقى الاختيار لهذه الجلسة وحدها */
    }
    announce();
  }

  function toggleAmounts() {
    const next = !hidden;
    if (next) document.documentElement.setAttribute("data-amounts", "hidden");
    else document.documentElement.removeAttribute("data-amounts");
    try {
      localStorage.setItem(AMOUNTS_KEY, next ? "hidden" : "shown");
    } catch {
      /* كما سبق */
    }
    announce();
  }

  const btn =
    "inline-flex min-h-11 w-9 items-center justify-center rounded-lg border border-line text-ink-soft transition-colors hover:border-ink-soft hover:text-ink sm:min-h-0 sm:h-8";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={toggleAmounts}
        className={btn}
        aria-pressed={hidden}
        title={hidden ? "أظهر المبالغ" : "أخفِ المبالغ — للعرض على غيرك"}
        aria-label={hidden ? "أظهر المبالغ" : "أخفِ المبالغ"}
      >
        {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        className={btn}
        title={dark ? "الوضع الفاتح" : "الوضع الداكن"}
        aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"}
      >
        {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}

/**
 * يكتب التفضيل على `<html>` قبل أوّل رسم.
 *
 * يُركَّب في `<head>` بـ`dangerouslySetInnerHTML` لأنّ هذا هو السبيل
 * الوحيد لتشغيل نصٍّ قبل أن يُرسَم الجسم — والنصّ من عندنا لا من مدخلٍ
 * خارجيّ، ولا يقرأ إلّا مفتاحين من تخزين هذا الجهاز.
 */
export function ThemePrimer() {
  const js = `(function(){try{
    var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});
    if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);
    if(localStorage.getItem(${JSON.stringify(AMOUNTS_KEY)})==="hidden")
      document.documentElement.setAttribute("data-amounts","hidden");
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}

/* ── الأيقونات: مرسومةٌ هنا كي لا تُضاف حزمةُ أيقونات لأربعة رموز ── */

function Sun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  );
}

function Moon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

function Eye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.8 3.6M6.2 7.3A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
