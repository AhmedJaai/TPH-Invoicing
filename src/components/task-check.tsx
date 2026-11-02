"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { toast } from "./ui-client";

/**
 * دائرةُ الإنجاز — ضغطةٌ واحدة، وتراجعٌ في الإشعار. المهمّةُ المكرَّرة تلد تاليتَها
 * والخادمُ يقول متى، ويمسحها التراجعُ فلا تبقى نسخةٌ زائدة.
 */
export function TaskCheck({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function done() {
    if (busy) return;
    setBusy(true);
    const r = await postJson<{ message?: string }>("/api/task", { action: "done", id });
    if (!r.ok) {
      setBusy(false);
      toast({ tone: "danger", title: "لم تُنجَز", body: r.error });
      return;
    }
    toast({
      tone: "ok",
      title: typeof r.data.message === "string" ? r.data.message : "أُنجزت",
      undo: {
        run: async () => {
          const u = await postJson("/api/task", { action: "reopen", id });
          if (u.ok) router.refresh();
          return u.ok;
        },
      },
    });
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={done}
      disabled={busy}
      aria-busy={busy}
      aria-label={`أنجز «${title}»`}
      className="group grid h-11 w-11 shrink-0 place-items-center rounded-full sm:h-8 sm:w-8"
    >
      <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-muted bg-raised text-transparent transition-colors group-hover:border-accent group-hover:text-accent group-disabled:opacity-50">
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
      </span>
    </button>
  );
}
