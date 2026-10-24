"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Merge } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { invoiceHref } from "@/lib/invoice-profile";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

interface Side {
  id: string;
  number: string;
  fileName: string;
  driveFileId: string | null;
  /** القيدُ الأقدم — يبقى بسداده وحوالته */
  older: boolean;
  /** سُجّلت من سطر كشف بلا ملفّ — ليست ورقةً تُختار */
  virtual?: boolean;
}

/**
 * «نسخة مكرّرة — ادمجهما» تحت تنبيه الفاتورة التوأم (`invoice-merge.service.ts`).
 *
 * القيدُ الأقدم يبقى دائماً بسداده؛ والسؤالُ الوحيد: أيُّ الورقتين تبقى؟
 * ولا يُرسَل مبلغ — الخادمُ يتحقّق أنّهما للمورّد نفسه وبالمبلغ نفسه.
 */
export function InvoiceMerge({ current, twin }: { current: Side; twin: Side }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const olderSide = current.older ? current : twin;
  const newerSide = current.older ? twin : current;
  /* الورقةُ الافتراضيّة ورقةُ الأقدم — إلّا أن تكون سطرَ كشفٍ بلا ملفّ والأخرى لها ملفّ */
  const [fileOf, setFileOf] = useState<string>(olderSide.virtual && !newerSide.virtual ? newerSide.id : olderSide.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = current.older ? current : twin;
  const dropped = current.older ? twin : current;

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ keptId: string; message: string }>("/api/invoice-merge", { invoiceId: current.id, twinId: twin.id, fileOf });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: "دُمجت الفاتورتان", body: r.data.message });
    if (r.data.keptId === current.id) router.refresh();
    else router.replace(invoiceHref(r.data.keptId));
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary", "sm")}>
        <Merge className="h-3.5 w-3.5" aria-hidden />
        نسخة مكرّرة؟ ادمجهما
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-line bg-raised p-4 text-xs text-ink shadow-raised">
      <p className="leading-relaxed text-ink-soft">
        يبقى القيد الأقدم <bdi className="nums font-bold text-ink">{kept.number}</bdi> بسداده وحوالته،
        وتُحذف <bdi className="nums font-bold text-ink">{dropped.number}</bdi>، ويعود ما خُصّص لها رصيداً للمورّد.
      </p>
      <fieldset className="mt-3">
        <legend className="mb-2 font-bold">أي ورقة تبقى للفاتورة؟</legend>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {[kept, dropped].map((s) => (
            <label
              key={s.id}
              className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 ${fileOf === s.id ? "border-accent bg-accent-soft" : "border-line"}`}
            >
              <input
                type="radio" name={`file-${current.id}`} value={s.id} checked={fileOf === s.id} onChange={() => setFileOf(s.id)} className="mt-0.5"
                disabled={s.virtual && !(s.id === kept.id ? dropped : kept).virtual}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold" dir="auto" title={s.fileName}>{s.fileName}</span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  {s.virtual ? "سطر من كشف المورّد بلا ملف، فلا يُختار ورقة" : s.older ? "ورقة القيد الأقدم" : "ورقة النسخة الأحدث"}
                </span>
                {s.driveFileId && (
                  <a
                    href={`https://drive.google.com/file/d/${s.driveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 font-bold text-accent hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden />
                    افتحها
                  </a>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">الورقة الأخرى ترفض وتبقى في الدرايف كما هي، وكل ذلك في سجل التدقيق.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={busy} aria-busy={busy} className={buttonClass("primary", "sm")}>
          {busy ? "يدمج…" : `احذف ${dropped.number} وأبقِ ${kept.number}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("quiet", "sm")}>تراجع</button>
        {error && <span role="alert" className="text-danger">{error}</span>}
      </div>
    </div>
  );
}
