"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";
import { buttonClass } from "./ui";
import { toast } from "./ui-client";

/**
 * دفعةٌ بلا مورّد ولا حركة بنك — تُحسَم في بندها.
 *
 * كان البند يقول «راجِعها في سجلّ التدقيق» ولا فعلَ له، فتبقى في الطابور
 * أبداً. والجوابُ في الإيصال نفسه: لمن حُوّلت؟ فيُفتح الإيصال، ثمّ تُنسَب
 * إلى مورّد، أو يُقال إنّها ليست لمورّدٍ ويُكتب ما هي.
 */
export function OrphanPayment({
  paymentId,
  suppliers,
  receiptUrl,
}: {
  paymentId: string;
  suppliers: { id: string; nameAr: string }[];
  receiptUrl: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "assign" | "void">("idle");
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const body = mode === "assign"
      ? { action: "assign", paymentId, supplierId }
      : { action: "void", paymentId, reason };
    const r = await postJson<{ message: string }>("/api/payment-orphan", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    /* بلا «تراجع»: مسارُ الدفعة اليتيمة لا يملك ردّاً، والزرُّ الذي لا يعمل أسوأ من غيابه */
    setDone(r.data.message);
    toast({ tone: "ok", title: r.data.message });
    router.refresh();
  }

  if (done) {
    return (
      <p className="flex items-center gap-1.5 text-xs font-bold text-ok" role="status">
        <CircleCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
        {done}
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {receiptUrl && (
          <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            افتح الإيصال
          </a>
        )}
        <button
          type="button"
          onClick={() => { setMode("assign"); setError(null); }}
          className={buttonClass(mode === "assign" ? "primary" : "secondary", "sm")}
        >
          انسبها إلى مورّد
        </button>
        <button
          type="button"
          onClick={() => { setMode("void"); setError(null); }}
          className={buttonClass(mode === "void" ? "primary" : "quiet", "sm")}
        >
          ليست لمورّد
        </button>
      </div>

      {mode === "assign" && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="المورّد"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-surface px-2 text-xs lg:min-h-9"
          >
            <option value="">اختر المورّد…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
          </select>
          <button aria-busy={busy} type="button" disabled={busy || !supplierId} onClick={submit} className={buttonClass("primary", "sm")}>
            انسبها
          </button>
        </div>
      )}

      {mode === "void" && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label="ما هذه الدفعة"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ما هي؟ أجرة · تحويل شخصيّ · مصروف…"
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-surface px-2 text-xs lg:min-h-9"
            />
            <button aria-busy={busy} type="button" disabled={busy || reason.trim().length < 3} onClick={submit} className={buttonClass("danger", "sm")}>
              ألغِ قيدَها
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            يُلغى قيدُها سداداً ولا يُحذَف: تبقى بحالها وسببها في السجلّ، والإيصالُ في الأرشيف.
          </p>
        </div>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] font-bold text-danger" role="alert">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
