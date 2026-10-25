"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Merge } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { invoiceHref } from "@/lib/invoice-profile";
import { formatDay } from "@/lib/riyadh-time";
import { METHOD_LABEL } from "@/lib/payment-state";
import { Money } from "./money";
import { T } from "@/components/i18n/t";
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

interface MergePreviewView {
  allocatedMinor: number;
  duplicates: { paymentId: string; amountMinor: number; method: string; day: string }[];
  closedMonths: string[];
  canVoid: boolean;
}

/**
 * «نسخة مكرّرة — ادمجهما» تحت تنبيه الفاتورة التوأم (`invoice-merge.service.ts`).
 *
 * القيدُ الأقدم يبقى دائماً بسداده؛ والسؤالان: أيُّ الورقتين تبقى؟ وإن كانت الساقطةُ وُسمت
 * «مسدّدة» بيدٍ والباقيةُ مسدّدة — أيُلغى ذلك السدادُ المكرّر (الافتراضيّ) أم يبقى رصيداً؟
 * المعاينةُ من الخادم، ولا يُرسَل مبلغ.
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
  const [preview, setPreview] = useState<MergePreviewView | null>(null);
  const [handPayments, setHandPayments] = useState<"void" | "keep">("void");
  const kept = current.older ? current : twin;
  const dropped = current.older ? twin : current;
  const dups = preview?.duplicates ?? [];
  const dupMinor = dups.reduce((n, d) => n + d.amountMinor, 0);
  /* الإلغاءُ ممكنٌ للمالك في شهرٍ مفتوح — وإلّا يبقى رصيداً ويُسأل عنه في «يحتاج قرارك» */
  const voidable = Boolean(preview?.canVoid) && (preview?.closedMonths.length ?? 0) === 0;
  const choice = dups.length > 0 && voidable ? handPayments : "keep";

  async function openPanel() {
    setOpen(true);
    setError(null);
    const r = await postJson<MergePreviewView>("/api/invoice-merge", { action: "preview", invoiceId: current.id, twinId: twin.id });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPreview(r.data);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ keptId: string; message: string }>("/api/invoice-merge", {
      action: "merge", invoiceId: current.id, twinId: twin.id, fileOf, handPayments: choice,
    });
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
      <button type="button" onClick={() => void openPanel()} className={buttonClass("secondary", "sm")}>
        <Merge className="h-3.5 w-3.5" aria-hidden />
        نسخة مكرّرة؟ ادمجهما
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-xl border border-line bg-raised p-4 text-xs text-ink shadow-raised">
      <p className="leading-relaxed text-ink-soft">
        يبقى القيد الأقدم <bdi className="nums font-bold text-ink">{kept.number}</bdi> بسداده وحوالته،
        وتُحذف <bdi className="nums font-bold text-ink">{dropped.number}</bdi>
        {dups.length > 0 ? "." : "، ويعود ما خُصّص لها رصيداً للمورّد."}
      </p>
      {dups.length > 0 && (
        <fieldset className="mt-3 rounded-lg border border-warn/30 bg-warn-bg px-3 py-2.5" disabled={busy}>
          <legend className="sr-only">السداد المكرّر</legend>
          <p className="leading-relaxed text-warn">
            <T s="{0} سُجّلت مسدّدة بيدك ({1})، و{2} مسدّدة أيضاً. فهذا السداد مكرّر، وإن بقي ظهر لك عند المورّد رصيد ليس لك." a={[<bdi key="0" className="nums font-bold">{dropped.number}</bdi>, <Money key="1" minor={dupMinor} />, <bdi key="2" className="nums font-bold">{kept.number}</bdi>]} />
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
            {dups.map((d) => (
              <li key={d.paymentId} className="flex flex-wrap justify-between gap-x-3">
                <span>{formatDay(d.day)} · {METHOD_LABEL[d.method] ?? d.method} · بلا حوالة في الكشف ولا إيصال</span>
                <Money minor={d.amountMinor} />
              </li>
            ))}
          </ul>
          {voidable ? (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
              {([
                ["void", "ألغِ السداد المكرّر", "يُلغى قيده بسبب مكتوب ويبقى في السجل. لا يتغيّر ما عليك."],
                ["keep", "اتركه رصيداً", "إن كنت دفعت فعلاً مرتين، فيبقى رصيداً لك عند المورّد."],
              ] as const).map(([value, title, sub]) => (
                <label key={value} className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border bg-raised px-3 py-2.5 ${handPayments === value ? "border-accent" : "border-line"}`}>
                  <input type="radio" name={`hand-${current.id}`} value={value} checked={handPayments === value} onChange={() => setHandPayments(value)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-ink">{title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted">{sub}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-muted">
              {preview && preview.closedMonths.length > 0
                ? <T s="شهر {0} مقفل، فيبقى رصيداً الآن. أعد فتحه لتلغيه من صفحة المورّد." a={[preview.closedMonths.join("، ")]} />
                : "إلغاؤه للمالك، فيبقى رصيداً الآن ويظهر للمالك في «يحتاج قرارك» ليلغيه."}
            </p>
          )}
        </fieldset>
      )}
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
        <button type="button" onClick={run} disabled={busy || !preview} aria-busy={busy} className={buttonClass("primary", "sm")}>
          {busy ? "يدمج…" : !preview ? "يحسب…" : `احذف ${dropped.number} وأبقِ ${kept.number}`}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("quiet", "sm")}>تراجع</button>
        {error && <span role="alert" className="text-danger">{error}</span>}
      </div>
    </div>
  );
}
