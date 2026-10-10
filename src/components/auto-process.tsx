"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { readAutoWork, summarizeAutoWork, type AutoWorkItem } from "@/lib/auto-work";
import { toast } from "./ui-client";

/**
 * «المفروض أوتوماتيك يسوي كل شيء» — أحمد، ٢٤ سبتمبر ٢٠٢٦.
 *
 * كان الاستدراكُ (قيدُ ما رُمي تاريخُه، واعتمادُ ما تجتمع فيه الشروط،
 * وتسميةُ المؤرشَف) ينتظر زرّ مزامنةٍ يُضغَط، والمزامنةُ نفسُها تنتظر
 * زرّاً. فصار يقع وحده في الخلفيّة لمن يملك أن يعتمد:
 *
 *   - الاستدراكُ عند فتح أيّ صفحة، مرّةً كلَّ عشر دقائق على الأكثر.
 *   - مزامنةُ الدرايف للجديد كلَّ ثلاث ساعات.
 *
 * والتوقيتُ في `localStorage` لراحة الجهاز وحده: إن تعذّر قُرئ «لم يقع»
 * فيُعاد — وهو آمن لأنّ كلَّ خطوةٍ تسأل القاعدة قبل أن تكتب.
 *
 * **وما وقع يُقال** (قاعدةُ ٧ أكتوبر ٢٠٢٦): كان العملُ يقيّد ويعتمد ثمّ تتحدّث
 * الصفحة بصمت، فيتبدّل «عليك للمورّدين» تحت العين بلا خبر. صار الردُّ يحمل ما وقع
 * بأعيانه ومبالغه، ويُعرَض إشعاراً: ماذا، وبكم زاد ما عليك، ورابطٌ إلى ما فُعل
 * وضابطُ إيقافه. والصفحةُ لا تُحدَّث ومن يكتب في حقلٍ يكتب — تنتظر خروجَه منه.
 * ومن أوقف العملَ الآليّ (في القاعدة، لكلّ جهاز) لا يجري له شيءٌ في الخلفيّة.
 *
 * **والفشلُ يُسمَع:** تفويضُ الدرايف الغائب أو المنتهي كان يُبتلَع هنا، فتقف
 * المزامنةُ أيّاماً ولا يدري أحد. صار يُقال في إشعارٍ مرّةً في الجلسة.
 */
const BACKLOG_EVERY_MS = 10 * 60_000;
const SYNC_EVERY_MS = 3 * 60 * 60_000;
/** مزامنةٌ تعثّرت (شبكةٌ انقطعت، ٥٠٢، مزامنةٌ أخرى جارية) تُعاد بعد خمس دقائق لا بعد ثلاث ساعات. */
const SYNC_RETRY_MS = 5 * 60_000;
/**
 * فحصٌ أوسع مرّةً في الأسبوع: الدوريّةُ تفحص شهرين، ففاتورةُ يوليو التي تصل في أكتوبر
 * وتوضع في مجلّد شهرها لا تُرى أبداً. فيُمشى على سنةٍ كاملة أسبوعياً، وما أوقفته المهلة يُستأنف.
 */
const DEEP_EVERY_MS = 7 * 24 * 60 * 60_000;
const DEEP_MONTHS = 12;
const DEEP_MAX_ROUNDS = 6;
const AUTH_TOLD_KEY = "tph:drive-auth-told";

function due(key: string, every: number): boolean {
  try {
    const last = Number(localStorage.getItem(key) ?? 0);
    if (Date.now() - last < every) return false;
    localStorage.setItem(key, String(Date.now()));
  } catch { /* بلا تخزين: يقع ولا ضرر */ }
  return true;
}

/** أحان وقتُه؟ — بلا كتابة: الطابعُ يُكتب بعد ردٍّ ناجح (`stamp`)، لا قبل الطلب. */
function elapsed(key: string, every: number): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(key) ?? 0) >= every;
  } catch { return true; }
}

function stamp(key: string, at = Date.now()) {
  try { localStorage.setItem(key, String(at)); } catch { /* بلا تخزين: يُعاد ولا ضرر */ }
}

interface SyncReply {
  summary?: { created?: number; truncated?: boolean; pendingMonths?: string[] };
  backlog?: { done?: unknown };
  needsAuth?: boolean;
  busy?: boolean;
  /** أوقفه صاحبُه — لم يجرِ شيء. */
  paused?: boolean;
  error?: string;
}

/** أيكتب المستخدمُ الآن؟ — تحديثُ الصفحة تحت يده يرمي ما كتب أو يقفز به. */
function typing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file"].includes(el.type);
}

/** يُحدَّث الآن، أو عند خروجه من الحقل إن كان يكتب. يُعيد ما يُلغي الانتظار. */
function refreshWhenIdle(refresh: () => void): () => void {
  if (!typing()) {
    refresh();
    return () => {};
  }
  const onBlur = () => {
    /* الانتقالُ من حقلٍ إلى حقلٍ ليس خروجاً — يُنظَر بعد أن يستقرّ التركيز */
    window.setTimeout(() => {
      if (typing()) return;
      document.removeEventListener("focusout", onBlur);
      refresh();
    }, 0);
  };
  document.addEventListener("focusout", onBlur);
  return () => document.removeEventListener("focusout", onBlur);
}

function tellOnce(message: string) {
  try {
    if (sessionStorage.getItem(AUTH_TOLD_KEY)) return;
    sessionStorage.setItem(AUTH_TOLD_KEY, "1");
  } catch { /* بلا تخزين: يُقال في كلّ مزامنة — أي كلَّ ثلاث ساعات */ }
  toast({
    tone: "warn",
    title: "مزامنةُ الدرايف متوقّفة",
    body: message,
    link: { label: "حالُ الدرايف", href: "/documents/drive" },
    duration: 10_000,
  });
}

export function AutoProcess({ drive = true }: { drive?: boolean }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let stopWaiting = () => {};
    (async () => {
      let changed = false;
      let arrived = 0;
      const done: AutoWorkItem[] = [];
      const counts = { renamed: 0, reread: 0, linked: 0 };
      /* وضعُ التجربة لا يحمل تفويض درايف عمداً — فلا يُسأل الدرايف ولا يُنذَر بتوقّفٍ مقصود */
      if (drive && elapsed("tph:auto-sync", SYNC_EVERY_MS)) {
        const deep = elapsed("tph:auto-sync-deep", DEEP_EVERY_MS);
        /* طلبٌ جارٍ: لا يبدأ لسانٌ آخر مثلَه قبل خمس دقائق — والطابعُ الصحيح يُكتب بعد الردّ */
        stamp("tph:auto-sync", Date.now() - SYNC_EVERY_MS + SYNC_RETRY_MS);
        let r = await postJson<SyncReply>(
          "/api/drive-sync",
          { apply: true, readContent: true, months: deep ? DEEP_MONTHS : 2, background: true },
        );
        /* الفحصُ الأوسع قد توقفه المهلة — تُستأنف أشهرُه الباقية بلا إعادة ما مضى */
        for (let round = 0; deep && r.ok && r.data.summary?.truncated && (r.data.summary.pendingMonths?.length ?? 0) > 0 && round < DEEP_MAX_ROUNDS; round++) {
          if ((r.data.summary.created ?? 0) > 0) changed = true;
          arrived += r.data.summary.created ?? 0;
          r = await postJson<SyncReply>(
            "/api/drive-sync",
            { apply: true, readContent: true, onlyMonths: r.data.summary.pendingMonths, background: true },
          );
        }
        /*
          الطابعُ بعد الردّ لا قبله: كان يُكتب قبل الإرسال، ففشلٌ عابر يُعدّ «وقعت» ولا تُعاد
          إلّا بعد ثلاث ساعات. والمتعثّرةُ (والتي ردّتها مزامنةٌ أخرى جارية) تُعاد بعد خمس دقائق.
        */
        const succeeded = r.ok && !r.data.busy && !r.data.needsAuth && !r.data.paused;
        stamp("tph:auto-sync", succeeded || (r.ok && (r.data.needsAuth || r.data.paused)) ? Date.now() : Date.now() - SYNC_EVERY_MS + SYNC_RETRY_MS);
        if (succeeded && deep && !r.data.summary?.truncated) stamp("tph:auto-sync-deep");
        if (r.ok && r.data.needsAuth) tellOnce(r.data.error ?? "تفويضُ الدرايف غائبٌ أو منتهٍ — سجّل الخروج ثمّ الدخول.");
        else if (succeeded) {
          arrived += r.data.summary?.created ?? 0;
          done.push(...readAutoWork(r.data.backlog?.done));
          if ((r.data.summary?.created ?? 0) > 0 || done.length > 0) changed = true;
        }
      }
      if (due("tph:auto-backlog", BACKLOG_EVERY_MS)) {
        const r = await postJson<{ recorded?: number; approved?: number; renamed?: unknown[]; reread?: number; handLinked?: number; done?: unknown }>(
          "/api/document-status",
          { action: "confirm-eligible", background: true },
        );
        if (r.ok && ((r.data.recorded ?? 0) + (r.data.approved ?? 0) + (r.data.renamed?.length ?? 0) + (r.data.reread ?? 0) + (r.data.handLinked ?? 0)) > 0) changed = true;
        if (r.ok) {
          done.push(...readAutoWork(r.data.done));
          counts.renamed += r.data.renamed?.length ?? 0;
          counts.reread += r.data.reread ?? 0;
          counts.linked += r.data.handLinked ?? 0;
        }
      }
      if (!changed || cancelled) return;
      /* ما وقع يُقال قبل أن تتبدّل الأرقام: ماذا، وبكم، وأين يُرى ويُوقَف */
      const summary = summarizeAutoWork(done, { arrived, ...counts });
      if (summary) {
        toast({
          tone: summary.touchesMoney ? "warn" : "info",
          title: summary.title,
          body: summary.body,
          link: { label: "اعرض ما فعله أو أوقفه", href: "/documents/drive#auto" },
          duration: 14_000,
        });
      }
      stopWaiting = refreshWhenIdle(() => { if (!cancelled) router.refresh(); });
    })();
    return () => { cancelled = true; stopWaiting(); };
  }, [router, drive]);

  return null;
}
