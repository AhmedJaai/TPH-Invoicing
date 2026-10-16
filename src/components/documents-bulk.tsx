"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { BulkBar, toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { postJson } from "@/lib/http-client";
import { DOCUMENT, countNoun } from "@/lib/arabic";
import { ACT } from "@/lib/ui-terms";

/**
 * اعتمادُ المحدَّد من المستندات — عشرةٌ بضغطة لا صفّاً صفّاً.
 *
 * يُرسَل لكلّ مستندٍ طلبُ الاعتماد اليدويّ نفسُه (`/api/document-status` · `confirm`)
 * واحداً واحداً: الخادمُ يحكم على كلٍّ ويكتب أثرَه، والنتيجةُ لكلّ صفٍّ تُقال — ما
 * اعتُمد بعدده، وما رُدّ باسمه وسببه. لا مبلغَ ولا حالَ يُرسَل من هنا.
 */
export function DocumentsBulk() {
  const router = useRouter();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const stop = useRef(false);

  async function approve(selected: { id: string; label: string }[], clear: () => void) {
    stop.current = false;
    setFailures([]);
    const failed: string[] = [];
    let ok = 0;
    let done = 0;
    for (const doc of selected) {
      if (stop.current) break;
      setProgress({ done, total: selected.length });
      const r = await postJson("/api/document-status", { documentId: doc.id, action: "confirm" });
      done++;
      if (r.ok) ok++;
      else failed.push(`${doc.label}: ${r.error}`);
    }
    setProgress(null);
    setFailures(failed);
    if (ok > 0) {
      toast({
        tone: failed.length > 0 ? "warn" : "ok",
        title: `اعتمد ${countNoun(ok, DOCUMENT)}`,
        body: [
          "دخلت فواتيرها المستحقّ، وخصم منها ما دفع للمورّد مقدّماً",
          failed.length > 0 ? `وردّ ${failed.length} — أسبابها في الشريط` : null,
          done < selected.length ? `وأوقفت قبل ${selected.length - done}` : null,
        ].filter(Boolean).join(" · "),
      });
      router.refresh();
    }
    /* ما رُدّ يبقى محدَّداً بسببه؛ وإن لم يُردّ شيءٌ فُرغ التحديد */
    if (failed.length === 0) clear();
  }

  return (
    <BulkBar>
      {(selected, clear) => (
        <>
          <button
            type="button"
            aria-busy={progress !== null}
            disabled={progress !== null}
            onClick={() => void approve(selected, clear)}
            className={buttonClass("primary", "sm")}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
            {ACT.approveDocument}{selected.length > 1 ? " — كلّ المحدّد" : ""}
          </button>
          {progress && (
            <span role="status" className="flex items-center gap-2 text-xs font-bold text-ink-soft">
              يعتمد <span className="nums nums-count">{progress.done + 1}</span> من <span className="nums nums-count">{progress.total}</span>
              <button type="button" onClick={() => { stop.current = true; }} className="min-h-8 text-accent hover:underline">أوقف بعد الحاليّ</button>
            </span>
          )}
          {failures.length > 0 && (
            <ul className="w-full space-y-0.5 text-[11px] leading-relaxed text-danger" role="alert">
              {failures.map((f) => <li key={f} dir="auto">{f}</li>)}
            </ul>
          )}
        </>
      )}
    </BulkBar>
  );
}
