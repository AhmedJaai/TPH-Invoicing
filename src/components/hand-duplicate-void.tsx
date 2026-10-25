"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eraser } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { Money } from "./money";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

interface Balance { owedMinor: number; creditLeftMinor: number }
interface PreviewView {
  outcome: {
    amountMinor: number;
    why: string;
    reopened: { id: string; number: string; amountMinor: number }[];
    balance: { before: Balance; after: Balance };
  } | null;
  refusal: string | null;
  months: string[];
}

/** «عليك له» أو «لك عنده» — الرصيدُ بجهته لا بإشارة. */
function BalanceLine({ b }: { b: Balance }) {
  if (b.creditLeftMinor > 0) return <T s="لك عنده {0}" a={[<Money key="0" minor={b.creditLeftMinor} />]} />;
  if (b.owedMinor > 0) return <T s="عليك له {0}" a={[<Money key="0" minor={b.owedMinor} />]} />;
  return <>متّزن</>;
}

/**
 * «ألغِ القيد المكرّر» — المعاينةُ من الخادم أوّلاً (الإلغاءُ نفسُه في معاملةٍ تُلغى):
 * أيُّ دفعة، ولماذا، و«عليك» قبل وبعد، وما يعود مفتوحاً. ثمّ تأكيدٌ واحد.
 * والشهرُ المقفل يُقال بأسمائه ولا يُجرَّب.
 */
export function HandDuplicateVoid({ paymentId, supplierName }: { paymentId: string; supplierName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* أُلغي — والصفحةُ تُحدَّث؛ فلا يبقى الزرُّ قابلاً للضغط ثانيةً في الأثناء */
  const [done, setDone] = useState(false);

  async function load() {
    setOpen(true);
    setError(null);
    setPreview(null);
    const r = await postJson<PreviewView>("/api/hand-duplicate", { action: "preview", paymentId });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPreview(r.data);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message: string }>("/api/hand-duplicate", { action: "void", paymentId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: "أُلغي القيد المكرّر", body: r.data.message });
    setDone(true);
    setOpen(false);
    router.refresh();
  }

  if (done) {
    return <p role="status" className="text-xs font-bold text-ok">أُلغي القيد المكرّر، ويُحدَّث الرصيد…</p>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => void load()} className={buttonClass("primary", "sm")}>
        <Eraser className="h-3.5 w-3.5" aria-hidden />
        ألغِ القيد المكرّر
      </button>
    );
  }

  const o = preview?.outcome;
  return (
    <div className="w-full rounded-xl border border-line bg-raised p-3 text-xs text-ink shadow-raised" aria-busy={!preview && !error}>
      {!preview ? (
        <p className="text-muted">{error ?? "يحسب ما سيتغيّر…"}</p>
      ) : preview.refusal || !o ? (
        <p role="alert" className="rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 leading-relaxed text-danger">
          {preview.refusal ?? "تعذّرت المعاينة. حدّث الصفحة."}
        </p>
      ) : (
        <>
          <p className="leading-relaxed text-ink-soft">
            <T s="يُلغى قيد {0}، ويبقى في السجل بسببه المكتوب أعلاه." a={[<Money key="0" minor={o.amountMinor} />]} />
          </p>
          {o.reopened.length > 0 && (
            <p className="mt-2 leading-relaxed text-warn">
              <T s="وكانت تسدّد منه {0}، فتعود مفتوحة." a={[o.reopened.map((r) => r.number).join("، ")]} />
            </p>
          )}
          <p className="mt-2 rounded-lg border border-line-soft bg-sunken px-3 py-2 leading-relaxed">
            <T s="رصيد {0}: قبل {1} · بعد {2}" a={[supplierName, <BalanceLine key="1" b={o.balance.before} />, <strong key="2"><BalanceLine b={o.balance.after} /></strong>]} />
          </p>
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {o && !preview?.refusal && (
          <button type="button" onClick={() => void run()} disabled={busy} aria-busy={busy} className={buttonClass("primary", "sm")}>
            {busy ? "يلغي…" : "تأكيد: ألغِ القيد المكرّر"}
          </button>
        )}
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={buttonClass("quiet", "sm")}>تراجع</button>
        {error && preview && <span role="alert" className="text-danger">{error}</span>}
      </div>
    </div>
  );
}
