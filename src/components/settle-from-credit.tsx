"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

/**
 * «سدّد بهذه الدفعة فواتيره المفتوحة» — لدفعةٍ زادت عن فاتورتها واستُردّت بخصمها من دفعةٍ لاحقة (أفال).
 * يكتب صاحبُها ما حدث بجملة (تُحفظ في التدقيق) ثمّ يعتمد؛ والخادمُ يقرأ المبالغَ ويوزّعها بالأقدم أوّلاً.
 */
export function SettleFromCredit({ paymentId, amountLabel, evidence = null }: { paymentId: string; amountLabel: string; evidence?: { ref: string | null; dateIso: string } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /* كشفُ المورّد عنده إشعارٌ دائن بالمبلغ نفسه؟ فالشرحُ جاهزٌ ويعدّله صاحبه */
  const suggested = evidence ? `إشعار المورّد الدائن ${evidence.ref ?? ""} (${evidence.dateIso}) بمبلغ ${amountLabel.split(" (")[0]}: استردّه المورّد بخصمه من دفعتنا الأخيرة`.replace(/\s+/g, " ") : "";
  const [note, setNote] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/unbacked-credit", { paymentId, note });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    toast({ tone: "ok", title: r.data.message ?? "سُدّدت الفواتير" });
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        سدّد بها فواتيره المفتوحة
      </button>
    );
  }
  return (
    <div className="w-full rounded-xl border border-line bg-sunken/50 p-3">
      <p className="text-xs leading-relaxed text-ink-soft">
        <T s="دفعنا {0} زيادةً واستردّها المورّد بخصمها من دفعةٍ لاحقة؟ اكتب ما حدث بإيجاز. تُحسب هذه الدفعة سداداً لفواتيره المفتوحة (الأقدم أولاً) ولا تُسجَّل دفعةٌ جديدة، وتُحفظ جملتك في سجلّ التدقيق." a={[<bdi key="0">{amountLabel}</bdi>]} />
      </p>
      {evidence && (
        <p className="mt-2 rounded-lg bg-ok-bg px-3 py-2 text-xs leading-relaxed text-ok">
          <T s="وجدنا في كشف المورّد سطراً دائناً بالمبلغ نفسه: {0}. هذا ما يشرح الخصم، فاقترحنا الشرح أدناه." a={[<bdi key="0" dir="ltr">{evidence.ref ?? "—"}</bdi>]} />
        </p>
      )}
      <label htmlFor={`settle-${paymentId}`} className="sr-only">ما حدث</label>
      <textarea
        id={`settle-${paymentId}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder="مثال: دفعنا زيادة، وطلبنا استردادها فخصمها المورّد من دفعتنا الأخيرة"
        className="mt-2 w-full resize-y rounded-lg border border-line-input bg-raised px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none"
        disabled={busy}
      />
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => void submit()} disabled={busy || note.trim().length < 3} aria-busy={busy} className={buttonClass("primary", "sm")}>
          اعتمد وسدّد
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} disabled={busy} className={buttonClass("quiet", "sm")}>
          إلغاء
        </button>
      </div>
    </div>
  );
}
