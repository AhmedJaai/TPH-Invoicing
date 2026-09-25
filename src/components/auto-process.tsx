"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
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
 * **والفشلُ يُسمَع:** تفويضُ الدرايف الغائب أو المنتهي كان يُبتلَع هنا، فتقف
 * المزامنةُ أيّاماً ولا يدري أحد. صار يُقال في إشعارٍ مرّةً في الجلسة.
 */
const BACKLOG_EVERY_MS = 10 * 60_000;
const SYNC_EVERY_MS = 3 * 60 * 60_000;
const AUTH_TOLD_KEY = "tph:drive-auth-told";

function due(key: string, every: number): boolean {
  try {
    const last = Number(localStorage.getItem(key) ?? 0);
    if (Date.now() - last < every) return false;
    localStorage.setItem(key, String(Date.now()));
  } catch { /* بلا تخزين: يقع ولا ضرر */ }
  return true;
}

function tellOnce(message: string) {
  try {
    if (sessionStorage.getItem(AUTH_TOLD_KEY)) return;
    sessionStorage.setItem(AUTH_TOLD_KEY, "1");
  } catch { /* بلا تخزين: يُقال في كلّ مزامنة — أي كلَّ ثلاث ساعات */ }
  toast({ tone: "warn", title: "مزامنةُ الدرايف متوقّفة", body: message, duration: 10_000 });
}

export function AutoProcess() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let changed = false;
      if (due("tph:auto-sync", SYNC_EVERY_MS)) {
        const r = await postJson<{ summary?: { created?: number }; needsAuth?: boolean; error?: string }>(
          "/api/drive-sync",
          { apply: true, readContent: true, months: 2, background: true },
        );
        if (r.ok && r.data.needsAuth) tellOnce(r.data.error ?? "تفويضُ الدرايف غائبٌ أو منتهٍ — سجّل الخروج ثمّ الدخول.");
        else if (r.ok && (r.data.summary?.created ?? 0) > 0) changed = true;
      }
      if (due("tph:auto-backlog", BACKLOG_EVERY_MS)) {
        const r = await postJson<{ recorded?: number; approved?: number; renamed?: unknown[]; reread?: number }>(
          "/api/document-status",
          { action: "confirm-eligible" },
        );
        if (r.ok && ((r.data.recorded ?? 0) + (r.data.approved ?? 0) + (r.data.renamed?.length ?? 0) + (r.data.reread ?? 0)) > 0) changed = true;
      }
      if (changed && !cancelled) router.refresh();
    })();
    return () => { cancelled = true; };
  }, [router]);

  return null;
}
