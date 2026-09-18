"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { ACT } from "@/lib/ui-terms";

/**
 * «سجّل أنّها سُدّدت» — في صفحة الفواتير نفسها.
 *
 * والفعل هو الفعل نفسه (`‎/api/mark-paid`)، لا مسارٌ ثانٍ يفعل الشيء
 * نفسه بطريقةٍ أخرى.
 *
 * ── ومن أين دُفعت؟ ──
 *
 * سؤالٌ واحد قبل الحفظ، لأنّ جوابيه يفعلان شيئين مختلفين:
 *
 *   «من حسابي أو نقداً» — لا يظهر في كشف المقهى أبداً. وما كان من
 *   حوالات المقهى مخصَّصاً عليها يُفَكّ ويُخصم من فواتير المورّد الأخرى.
 *   فتُعرض المعاينة أوّلاً: ما سينتقل، وما يبقى لك عنده.
 *
 *   «حوالة من حساب المقهى» — تُسجَّل دفعة، وحين يصل الكشف تُطابَق بها.
 */

interface Preview {
  invoiceNumber: string;
  ownerPaymentMinor: number;
  freed: { paymentId: string; paidAt: string; amountMinor: number }[];
  reapplied: { invoiceId: string; invoiceNumber: string; amountMinor: number }[];
  creditLeftMinor: number;
}

type State = "idle" | "choose" | "previewing" | "confirm-owner" | "confirm-bank" | "busy" | "done";

async function post(body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> } | null> {
  let res: Response;
  try {
    res = await fetch("/api/mark-paid", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
  const text = await res.text().catch(() => "");
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* ليس JSON — صفحة خطأٍ من المنصّة */
  }
  return { ok: res.ok, status: res.status, data };
}

function describePreview(p: Preview): string {
  const parts = [`تُقيَّد دفعةٌ من حسابك بـ${formatRiyalsDisplay(p.ownerPaymentMinor)}`];
  const freed = p.freed.reduce((s, f) => s + f.amountMinor, 0);
  if (freed > 0) {
    const moved = p.reapplied
      .map((r) => `فاتورة ${r.invoiceNumber} بـ${formatRiyalsDisplay(r.amountMinor)}`)
      .join("، ");
    parts.push(
      `وتُفَكّ عنها حوالاتُ المقهى (${formatRiyalsDisplay(freed)})`
      + (moved ? ` وتُخصم من: ${moved}` : ""),
    );
  }
  if (p.creditLeftMinor > 0) parts.push(`ويبقى لك عنده ${formatRiyalsDisplay(p.creditLeftMinor)}`);
  return parts.join(" · ");
}

export function MarkInvoicePaid({
  invoiceId,
  label,
}: {
  invoiceId: string;
  label: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  function fail(r: Awaited<ReturnType<typeof post>>, back: State) {
    setMessage(
      r === null
        ? "تعذّر الاتصال بالخادم — لم يصل الطلب."
        : String(r.data.error ?? `تعذّر الحفظ — ردّ الخادم بالرمز ${r.status}`),
    );
    setState(back);
  }

  async function loadOwnerPreview() {
    setState("previewing");
    setMessage(null);
    const r = await post({ invoiceIds: [invoiceId], source: "OWNER", preview: true });
    if (!r || !r.ok) return fail(r, "choose");
    setPreview(r.data.preview as Preview);
    setState("confirm-owner");
  }

  async function run(source: "OWNER" | "BANK") {
    setState("busy");
    setMessage(null);
    const r = await post({ invoiceIds: [invoiceId], source });
    if (!r || !r.ok) return fail(r, source === "OWNER" ? "confirm-owner" : "confirm-bank");

    /*
      «٢٠٠» تقول إنّ الطلب فُهم، لا إنّ شيئاً كُتب — المسار يردّ
      `marked: 0` حين لا يجد فاتورةً تنطبق.
    */
    if (r.data.marked === 0) {
      setMessage("لم يُكتب شيء — قد تكون مسدَّدةً أصلاً.");
      setState("choose");
      return;
    }
    setState("done");
    setMessage(String(r.data.message ?? "سُجّلت مسدَّدة"));
    router.refresh();
  }

  if (state === "done") {
    return <span className="text-[11px] font-bold text-ok">✓ {message}</span>;
  }

  /*
    الصفّ كلّه رابطٌ إلى صفحة المورّد، فالضغطة على الزرّ تنتشر إليه
    فتنقل الصفحة قبل أن يقع شيء. فتُوقَف هنا.
  */
  const stop = (e: { stopPropagation(): void; preventDefault(): void }) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const small = "min-h-8 rounded-lg px-2.5 py-1 text-[11px]";

  return (
    <span onClick={stop} className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5">
      {state === "idle" && (
        <button
          type="button"
          onClick={() => setState("choose")}
          className={`${small} border border-line font-medium hover:border-ink-soft`}
        >
          سجّل أنّها سُدّدت
        </button>
      )}

      {(state === "choose" || state === "previewing") && (
        <>
          <span className="text-[11px] text-muted">من أين دُفعت؟</span>
          <button
            type="button"
            disabled={state === "previewing"}
            onClick={loadOwnerPreview}
            className={`${small} border border-line font-bold hover:border-ink-soft disabled:opacity-50`}
          >
            {state === "previewing" ? "يحسب…" : "من حسابي أو نقداً"}
          </button>
          <button
            type="button"
            disabled={state === "previewing"}
            onClick={() => setState("confirm-bank")}
            className={`${small} border border-line font-medium hover:border-ink-soft disabled:opacity-50`}
          >
            حوالة من حساب المقهى
          </button>
          <button type="button" onClick={() => { setState("idle"); setMessage(null); }} className="text-[11px] underline">
            تراجع
          </button>
        </>
      )}

      {(state === "confirm-owner" || (state === "busy" && preview)) && preview && (
        <>
          <span className="text-[11px] leading-relaxed text-ink-soft">{describePreview(preview)}</span>
          <button
            type="button"
            disabled={state === "busy"}
            onClick={() => run("OWNER")}
            className={`${small} bg-inverse-surface font-bold text-inverse-ink disabled:opacity-50`}
          >
            {state === "busy" ? "يحفظ…" : ACT.paidFromOwner}
          </button>
          <button type="button" onClick={() => { setState("choose"); setPreview(null); setMessage(null); }} className="text-[11px] underline">
            تراجع
          </button>
        </>
      )}

      {(state === "confirm-bank" || (state === "busy" && !preview)) && (
        <>
          <span className="text-[11px] text-muted">تُنشأ دفعة بـ{label} وتُخصَّص عليها</span>
          <button
            type="button"
            disabled={state === "busy"}
            onClick={() => run("BANK")}
            className={`${small} bg-inverse-surface font-bold text-inverse-ink disabled:opacity-50`}
          >
            {state === "busy" ? "يحفظ…" : ACT.recordBankTransfer}
          </button>
          <button type="button" onClick={() => { setState("choose"); setMessage(null); }} className="text-[11px] underline">
            تراجع
          </button>
        </>
      )}

      {message && <span className="text-[11px] font-bold text-danger">{message}</span>}
    </span>
  );
}
