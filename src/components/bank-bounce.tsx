"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Undo2 } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { formatRiyalsDisplay } from "@/lib/money";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/** حوالةٌ خرجت ثمّ عادت بالمبلغ نفسه — «ارتدّت» تردّ الدفعة، و«ليست ردّاً» يُغلق التنبيه. */
export function BankBounce({ pair, currentId }: {
  pair: { outgoingId: string; incomingId: string; outDay: string; backDay: string; amountMinor: number };
  currentId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = currentId === pair.outgoingId ? pair.incomingId : pair.outgoingId;

  async function decide(decision: "BOUNCED" | "NOT_BOUNCE") {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/bank-bounce", { outgoingId: pair.outgoingId, incomingId: pair.incomingId, decision });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: r.data.message ?? "حُسم" });
    router.refresh();
  }

  return (
    <div className="mt-3 rounded-xl border border-warn/25 bg-warn-bg p-3 text-xs leading-relaxed">
      <p className="flex items-center gap-1.5 font-bold">
        <Undo2 className="h-4 w-4 text-warn" aria-hidden />
        خرجت {formatRiyalsDisplay(pair.amountMinor)} في <bdi className="nums">{pair.outDay}</bdi> وعاد المبلغُ نفسُه في <bdi className="nums">{pair.backDay}</bdi>
      </p>
      <p className="mt-1 text-ink-soft">
        إن كانت الحوالةُ ارتدّت فالفاتورةُ التي قُيّدت عليها لم تُسدَّد. «ارتدّت» تردّ الدفعة فتعود مستحقّة — ثمّ أعِد التحويل.{" "}
        <Link href={`/bank/tx/${other}`} className="font-bold text-accent hover:underline">افتح الحركة الأخرى</Link>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => decide("BOUNCED")} className={buttonClass("primary", "sm")}>ارتدّت</button>
        <button type="button" disabled={busy} onClick={() => decide("NOT_BOUNCE")} className={buttonClass("secondary", "sm")}>ليست ردّاً</button>
      </div>
      {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
    </div>
  );
}
