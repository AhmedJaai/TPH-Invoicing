"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing, CircleAlert, CircleCheck, Info, Smartphone } from "lucide-react";
import { ActionButton } from "./ui-client";
import { postJson } from "@/lib/http-client";

type Support =
  | { kind: "checking" }
  | { kind: "unsupported" }
  /** آيفون/آيباد في المتصفّح: الإشعارُ للتطبيق المثبَّت وحده (iOS 16.4 فما بعد) */
  | { kind: "ios-install" }
  | { kind: "denied" }
  | { kind: "ready"; subscribed: boolean };

function isIos(): boolean {
  const ua = navigator.userAgent;
  /* آيباد الحديث يقول «Macintosh» — ويُعرف باللمس */
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** مفتاحُ VAPID (base64url) بالصيغة التي يطلبها `pushManager.subscribe`. */
function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

/**
 * إشعارُ الصباح على هذا الجهاز — يُفعَّل ويُوقف من هنا.
 *
 * - **خاملٌ بلا مفاتيح الخادم** (`publicKey` فارغ): يُقال ذلك ولا زرّ.
 * - **آيفون:** أبل لا تُرسل إشعاراتِ المواقع إلّا للتطبيق المثبَّت على الشاشة الرئيسية
 *   (iOS 16.4 فما بعد) — فيُشرح التثبيت بدل زرٍّ لا يعمل.
 * - **بلا مبالغ على شاشة القفل:** النصُّ عددُ ما ينتظر قرارك، والأرقامُ في التطبيق.
 */
export function PushSettings({ publicKey }: { publicKey: string | null }) {
  const [support, setSupport] = useState<Support>({ kind: "checking" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      let next: Support;
      if (isIos() && !isStandalone()) next = { kind: "ios-install" };
      else if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) next = { kind: "unsupported" };
      else if (Notification.permission === "denied") next = { kind: "denied" };
      else {
        const reg = await registration();
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        next = { kind: "ready", subscribed: sub !== null };
      }
      if (alive) setSupport(next);
    })().catch(() => { if (alive) setSupport({ kind: "unsupported" }); });
    return () => { alive = false; };
  }, []);

  async function subscribe(): Promise<boolean> {
    setError(null);
    if (!publicKey) return false;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      if (permission === "denied") setSupport({ kind: "denied" });
      setError("لم يُسمح بالإشعارات على هذا الجهاز، فلم يُفعَّل شيء.");
      return false;
    }
    /* عاملُ الخدمة يُسجَّل في النسخة الفعليّة وحدها (`service-worker.tsx`) — وبدونه لا إشعار */
    const reg = await registration();
    if (!reg) {
      setError("الإشعار يعمل من النسخة الفعلية للتطبيق فقط، وعامل الخدمة غير مسجّل هنا. حدّث الصفحة وأعد المحاولة.");
      return false;
    }
    let sub: PushSubscription;
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
    } catch {
      setError("رفض المتصفح الاشتراك في الإشعارات. أعد المحاولة، أو جرّب من متصفح آخر.");
      return false;
    }
    const r = await postJson("/api/push", { action: "subscribe", subscription: sub.toJSON() });
    if (!r.ok) {
      /* ما لم يحفظه الخادم لا يبقى مشتركاً في المتصفّح — وإلّا قال الزرُّ «مفعّل» ولا يصل شيء */
      await sub.unsubscribe().catch(() => undefined);
      setError(r.error);
      return false;
    }
    setSupport({ kind: "ready", subscribed: true });
    return true;
  }

  async function unsubscribe(): Promise<boolean> {
    setError(null);
    const reg = await registration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      const r = await postJson("/api/push", { action: "unsubscribe", endpoint: sub.endpoint });
      if (!r.ok) {
        setError(r.error);
        return false;
      }
      await sub.unsubscribe().catch(() => undefined);
    }
    setSupport({ kind: "ready", subscribed: false });
    return true;
  }

  const note = (icon: React.ReactNode, text: React.ReactNode, tone = "text-ink-soft") => (
    <p className={`flex items-start gap-2 text-xs leading-relaxed ${tone}`}>{icon}<span>{text}</span></p>
  );
  const iconCls = "mt-0.5 h-4 w-4 shrink-0";

  return (
    <div className="space-y-3 rounded-xl border border-line bg-raised p-5 shadow-raised">
      <p className="text-xs leading-relaxed text-ink-soft">
        إشعار واحد كل صباح بعدد ما ينتظر قرارك، وهل دفعة المورّدين جاهزة. لا يظهر فيه أي مبلغ، لأنه يُرى على شاشة القفل، والأرقام تراها بعد فتح التطبيق.
      </p>

      {!publicKey ? (
        note(<Info className={`${iconCls} text-muted`} strokeWidth={2} aria-hidden />, "إشعار الصباح غير مفعّل على الخادم بعد. يفعّله مالك الحساب بإضافة مفاتيح الإشعار في إعدادات النشر، ثم يظهر الزر هنا.")
      ) : support.kind === "checking" ? (
        <p className="text-xs text-muted" role="status">يفحص دعم الإشعارات على هذا الجهاز…</p>
      ) : support.kind === "ios-install" ? (
        note(<Smartphone className={`${iconCls} text-info`} strokeWidth={2} aria-hidden />, "على آيفون وآيباد تصل الإشعارات إلى التطبيق المثبَّت فقط (iOS 16.4 أو أحدث): من Safari اضغط «مشاركة» ثم «إضافة إلى الشاشة الرئيسية»، وافتح التطبيق من أيقونته، ثم ارجع إلى هذا القسم.")
      ) : support.kind === "unsupported" ? (
        note(<CircleAlert className={`${iconCls} text-warn`} strokeWidth={2} aria-hidden />, "هذا المتصفح لا يدعم الإشعارات. جرّب Chrome أو Edge أو Safari حديثاً.")
      ) : support.kind === "denied" ? (
        note(<BellOff className={`${iconCls} text-warn`} strokeWidth={2} aria-hidden />, "الإشعارات محظورة لهذا الموقع في إعدادات المتصفح. اسمح بها من إعدادات الموقع، ثم حدّث الصفحة.")
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {support.subscribed ? (
            <>
              {note(<CircleCheck className={`${iconCls} text-ok`} strokeWidth={2} aria-hidden />, "مفعّل على هذا الجهاز.", "text-ok font-bold")}
              <ActionButton onAction={unsubscribe} size="sm" variant="quiet" busyText="يوقف الإشعار…">
                <BellOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                <span>أوقفه على هذا الجهاز</span>
              </ActionButton>
            </>
          ) : (
            <ActionButton onAction={subscribe} size="sm" variant="primary" busyText="يطلب إذن الإشعار ويسجّل الجهاز…">
              <BellRing className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              <span>فعّل إشعار الصباح على هذا الجهاز</span>
            </ActionButton>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-[11px] font-bold text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
