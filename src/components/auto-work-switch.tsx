"use client";

import { useRouter } from "next/navigation";
import { useState, Fragment } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { ActionButton, toast } from "./ui-client";
import { postJson } from "@/lib/http-client";
import { T } from "@/components/i18n/t";

/**
 * ضابطُ العمل الآليّ — «أوقفه» و«شغّله» حيث يُعرَض ما فعله.
 *
 * الحالُ من الخادم (صفٌّ في القاعدة يسري على كلّ جهاز) والزرُّ ينتظر ردَّه؛ لا
 * يُكتب متفائلاً: «موقوف» تُقال حين يُوقَف فعلاً.
 */
export function AutoWorkSwitch({ paused, since }: { paused: boolean; since: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setError(null);
    const r = await postJson<{ message?: string }>("/api/auto-process", { paused: next });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: next ? "warn" : "ok", title: next ? "أُوقف العمل الآلي" : "عاد العمل الآلي", body: r.data.message });
    router.refresh();
    return true;
  }

  return (
    <div
      id="auto"
      className={`flex scroll-mt-24 flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3 ${paused ? "border-warn/30 bg-warn-bg" : "border-line bg-raised"}`}
    >
      {paused
        ? <PauseCircle className="h-5 w-5 shrink-0 text-warn" strokeWidth={2} aria-hidden />
        : <PlayCircle className="h-5 w-5 shrink-0 text-ok" strokeWidth={2} aria-hidden />}
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-bold">{paused ? "العمل الآلي موقوف" : "العمل الآلي يعمل"}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
          {paused
            ? <><T s="لا يُسجَّل ولا يُعتمد ولا يُزامَن شيء في الخلفية{0}، على كل الأجهزة. زر «زامن الآن» يعمل حين تضغطه." a={[since ? <Fragment key="0"> <T s=" منذ {0}" a={[since]} /></Fragment> : null]} /></>
            : "يسجّل الفواتير المقروءة كاملة، ويعتمد ما اجتمعت شروطه، ويخبرك بما فعله وبمقدار ما زاد عليك. تجد ما نفّذه في «آخر ما فعله» أدناه، وافتح المستند لتصحّحه أو ترفضه."}
        </p>
        {error && <p role="alert" className="mt-1 text-xs font-bold text-danger">{error}</p>}
      </div>
      <ActionButton onAction={() => set(!paused)} variant={paused ? "primary" : "secondary"} size="sm" showDone={false}>
        {paused ? "شغّله" : "أوقف العمل الآلي"}
      </ActionButton>
    </div>
  );
}
