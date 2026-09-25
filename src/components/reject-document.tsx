"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * رفضٌ بخطوتين: الضغطة الأولى تسأل عن السبب، والثانية ترفض — ولا يُحذف الملفّ.
 *
 * ولا تراجعَ في الإشعار: الرفضُ يُسقط الفاتورة، و«أعِده للمراجعة» يقيّدها
 * من قراءتها المحفوظة من جديد — فما صُحّح بيدٍ لا يعود كما كان. فيُقال
 * أين يجده ومن أين يُعاد، ولا يُوعَد بتراجعٍ ليس تراجعاً.
 */
export function RejectDocument({ documentId, cancel = false, redirectTo }: {
  documentId: string;
  /** مستندٌ معتمَد يُلغى — فاتورةٌ ألغاها المورّد. ويُكتَب السبب. */
  cancel?: boolean;
  /**
   * وجهةٌ بعد النجاح. الإلغاءُ من ملفّ الفاتورة يُسقط الفاتورة نفسها،
   * فالتحديثُ في موضعه يفتح «لم نجد هذه الصفحة» — طريقٌ مسدود بعد فعلٍ نجح.
   */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState(cancel ? "ألغاها المورّد" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button type="button" className={buttonClass(cancel ? "danger" : "quiet", "sm")} onClick={() => setAsking(true)}>
        <Ban className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {cancel ? "ألغِ الفاتورة" : "ارفضه"}
      </button>
    );
  }

  return (
    <span className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="السبب (اختياريّ)"
        aria-label={cancel ? "سبب الإلغاء" : "سبب الرفض"}
        autoFocus
        className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-2.5 text-xs sm:min-h-8 sm:w-44 sm:flex-none"
      />
      <button
        type="button"
        disabled={busy}
        className={buttonClass("danger", "sm")}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await postJson("/api/document-status", { documentId, reason: reason.trim() || undefined });
          setBusy(false);
          if (!r.ok) { setError(r.error); return; }
          toast({
            tone: "info",
            title: cancel ? "أُلغيت الفاتورة" : "رُفض المستند",
            body: cancel
              ? "خرجت من المستحقّ، وبقي ملفُّها في الدرايف والأثرُ في السجلّ."
              : "بقي ملفُّه في الدرايف — تجده تحت «رُفض» في المستندات، ومنه يُعاد إلى المراجعة.",
          });
          if (redirectTo) router.push(redirectTo);
          else router.refresh();
        }}
      >
        {busy ? (cancel ? "يُلغي…" : "يرفض…") : cancel ? "نعم، ألغِها" : "نعم، ارفضه"}
      </button>
      <button type="button" className={buttonClass("quiet", "sm")} onClick={() => { setAsking(false); setError(null); }}>
        تراجع
      </button>
      {error && <span className="w-full text-[11px] font-bold text-danger" role="alert">{error}</span>}
    </span>
  );
}
