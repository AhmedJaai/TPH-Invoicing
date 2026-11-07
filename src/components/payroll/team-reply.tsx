"use client";

/**
 * الردُّ على رسالةٍ من الفريق — يراه الموظّفُ في «TPH Team» تحت رسالته.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Reply } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass, fieldClass } from "../ui-tokens";
import { ReadySubmit, toast } from "../ui-client";

const MAX = 1000;

export function TeamReplyForm({ id, current }: { id: string; current: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) {
    return (
      <button type="button" className={buttonClass(current ? "quiet" : "secondary", "sm")} onClick={() => setOpen(true)}>
        <Reply className="h-3.5 w-3.5" aria-hidden />{current ? "عدّل الرد" : "رُدّ عليه"}
      </button>
    );
  }
  const length = text.trim().length;
  return (
    <form className="basis-full space-y-2" onSubmit={async (e) => {
      e.preventDefault();
      if (busy || length === 0 || length > MAX) return;
      setBusy(true);
      setError(null);
      const r = await postJson<{ message?: string }>("/api/payroll/messages", { action: "reply", id, reply: text });
      setBusy(false);
      if (!r.ok) { setError(r.error); return; }
      toast({ tone: "ok", title: r.data.message ?? "أُرسل الرد" });
      setOpen(false);
      router.refresh();
    }}>
      <label htmlFor={`reply-${id}`} className="block text-xs font-bold text-ink-soft">ردّك</label>
      <textarea id={`reply-${id}`} className={`${fieldClass("md", false)} min-h-20 py-2`} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX + 50} autoFocus />
      <div className="flex flex-wrap items-center gap-2">
        <ReadySubmit ready={length > 0 && length <= MAX} busy={busy} size="sm" missing={length > MAX ? `الرد أطول من ${MAX} حرف.` : "اكتب الرد أولاً."}>{busy ? "يُرسل…" : "أرسل الرد"}</ReadySubmit>
        <button type="button" className={buttonClass("quiet", "sm")} onClick={() => { setOpen(false); setText(current ?? ""); setError(null); }}>تراجع</button>
        <span className={`ms-auto text-[11px] ${length > MAX ? "font-bold text-danger" : "text-muted"}`}><span className="nums">{length}</span> / <span className="nums">{MAX}</span></span>
      </div>
      {error && <p role="alert" className="text-[11px] font-bold text-danger">{error}</p>}
    </form>
  );
}
