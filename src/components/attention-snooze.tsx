"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlarmClock, BellOff, CircleAlert } from "lucide-react";
import { buttonClass } from "./ui";
import { Popover, toast } from "./ui-client";
import { postJson } from "@/lib/http-client";
import { T } from "@/components/i18n/t";

/**
 * «أجِّله إلى…» — قرارٌ صغير بجانب البند: متى يعود، ولماذا (اختياريّ).
 * الأيّامُ الجاهزة يحسبها الخادم بتوقيت الرياض وتُمرَّر؛ والخادمُ يفحص اليومَ ثانيةً.
 */
export function SnoozeControl({ itemId, options }: { itemId: string; options: readonly { label: string; day: string }[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function snooze(day: string, close: () => void) {
    if (busy) return;
    setBusy(day);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/attention-snooze", { itemId, until: day, note: note.trim() || undefined });
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    close();
    toast({
      tone: "ok",
      title: r.data.message ?? "أُجّل",
      undo: {
        run: async () => {
          const u = await postJson("/api/attention-snooze", { itemId, until: null });
          if (u.ok) router.refresh();
          return u.ok;
        },
      },
    });
    router.push("/attention");
    router.refresh();
  }

  return (
    <Popover
      buttonLabel="أجّل هذا البند"
      buttonClassName={buttonClass("quiet", "md")}
      button={<><T s="{0}أجّله أو علمت" a={[<AlarmClock key="0" className="h-4 w-4" strokeWidth={2} aria-hidden />]} /></>}
      width="19rem"
    >
      {(close) => (
        <div>
          <p className="text-sm font-bold">متى يعود؟</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">يخرج من العدد ويبقى ظاهراً في «المؤجّل»، ويعود تلقائياً في اليوم المحدد، أو قبله إن تغيّر مبلغه.</p>
          <label className="mt-3 block text-[11px] font-bold text-ink-soft" htmlFor={`snooze-note-${itemId}`}>السبب (اختياري)</label>
          <input
            id={`snooze-note-${itemId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="أنتظر ردّ المورّد"
            className="mt-1 h-10 w-full rounded-lg border border-line bg-raised px-3 text-sm"
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {options.map((o) => (
              <button
                key={o.day}
                type="button"
                disabled={busy !== null}
                aria-busy={busy === o.day}
                onClick={() => void snooze(o.day, close)}
                className={buttonClass("secondary", "sm")}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy !== null}
            aria-busy={busy === "dismiss"}
            onClick={() => void snooze("dismiss", close)}
            className={`${buttonClass("quiet", "sm")} mt-2 w-full justify-center`}
          >
            <BellOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            علمت، لا تظهره حتى يتغيّر
          </button>
          {error && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-danger">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              {error}
            </p>
          )}
        </div>
      )}
    </Popover>
  );
}
