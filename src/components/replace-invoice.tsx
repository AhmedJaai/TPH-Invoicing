"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Replace } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «فاتورةٌ مصحَّحة — استبدل بها المقيَّدة» (`/api/invoice-replace`).
 * ضغطتان: الأولى تقول ما سيقع، والثانية تُقرّه — والخادمُ يقرأ المبلغين ولا يأخذهما من هنا.
 */
export function ReplaceInvoice({ documentId, number, before, after }: { documentId: string; number: string; before: string; after: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button type="button" className={buttonClass("primary", "sm")} onClick={() => setAsking(true)}>
        <Replace className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        فاتورةٌ مصحَّحة — استبدل بها المقيَّدة
      </button>
    );
  }
  return (
    <span className="flex w-full flex-col gap-2 rounded-lg border border-accent-line bg-sunken px-3 py-2.5 text-xs leading-relaxed">
      <span>
        تحلّ هذه محلّ <bdi className="nums font-bold">{number}</bdi>: مبلغُها <bdi className="nums font-bold">{before}</bdi> ← <bdi className="nums font-bold">{after}</bdi>،
        وبنودُها وحكمُها الضريبيّ من هذه القراءة، وما سُدِّد فوق المبلغ الجديد يعود رصيداً للمورّد. والمستندُ القديم يُرفض ويبقى في السجلّ.
      </span>
      <span className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-busy={busy}
          disabled={busy}
          className={buttonClass("primary", "sm")}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await postJson<{ message: string; invoiceId: string }>("/api/invoice-replace", { documentId });
            setBusy(false);
            if (!r.ok) { setError(r.error); return; }
            toast({ tone: "ok", title: "استُبدلت الفاتورة", body: r.data.message });
            router.refresh();
          }}
        >
          {busy ? "يستبدل…" : "نعم، استبدلها"}
        </button>
        <button type="button" disabled={busy} className={buttonClass("quiet", "sm")} onClick={() => setAsking(false)}>تراجع</button>
      </span>
      {error && <span role="alert" className="text-danger">{error}</span>}
    </span>
  );
}
