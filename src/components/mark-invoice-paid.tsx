"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Landmark, Wallet } from "lucide-react";
import { formatRiyalsDisplay } from "@/lib/money";
import { postJson } from "@/lib/http-client";
import { ACT } from "@/lib/ui-terms";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

/**
 * «سجّل أنّها سُدّدت» — في صفحة الفواتير وملفّ الفاتورة.
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
 *
 * ── والتراجع ──
 *
 * بعد ردّ الخادم وحده (لا تفاؤلَ عن مال)، ولما يعيد الخادمُ معرّفاتِ
 * دفعاته وحده: الحوالةُ المسجَّلة تُلغى من الإشعار ما دامت قريبة
 * (`/api/mark-paid/undo`). والسدادُ من حساب المالك ينقل حوالاتٍ بين
 * فواتير فلا يُعكَس بضغطة، فلا يُعرَض له تراجع.
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

function describePreview(p: Preview): string[] {
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
  return parts;
}

export function MarkInvoicePaid({
  invoiceId,
  label,
  layout = "inline",
  startOpen = false,
}: {
  invoiceId: string;
  /** المتبقّي نصّاً مقروءاً — من الخادم، لا يُحسَب هنا. */
  label: string;
  /** `inline` في صفّ جدول، و`panel` في ملفّ الفاتورة: الخياران بطاقتان. */
  layout?: "inline" | "panel";
  /** يُفتح والسؤالُ مطروح — حين جاء صاحبُه ليسجّل السداد نفسَه. */
  startOpen?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>(startOpen ? "choose" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const panel = layout === "panel";

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
      setMessage("لم يُكتب شيء — قد تكون مسدَّدةً أصلاً. حدّث الصفحة.");
      setState("choose");
      return;
    }
    setState("done");
    const text = String(r.data.message ?? "سُجّلت مسدَّدة");
    const paymentIds = Array.isArray(r.data.paymentIds)
      ? r.data.paymentIds.filter((x): x is string => typeof x === "string")
      : [];
    toast({
      tone: "ok",
      title: "سُجّلت الفاتورة مسدَّدة",
      body: text,
      undo: paymentIds.length > 0
        ? {
            run: async () => {
              const u = await postJson<{ message?: string }>("/api/mark-paid/undo", { paymentIds });
              if (!u.ok) {
                toast({ tone: "danger", title: "تعذّر التراجع", body: u.error });
                return false;
              }
              setState("idle");
              router.refresh();
              return true;
            },
          }
        : undefined,
    });
    router.refresh();
  }

  if (state === "done") {
    return <span className="text-[11px] font-bold text-ok">✓ سُجّلت مسدَّدة</span>;
  }

  /*
    الصفّ كلّه رابطٌ إلى ملفّ الفاتورة، فالضغطة على الزرّ تنتشر إليه
    فتنقل الصفحة قبل أن يقع شيء. فتُوقَف هنا.
  */
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  const back = (to: State) => () => { setState(to); setMessage(null); if (to !== "confirm-owner") setPreview(null); };

  return (
    <div
      onClick={stop}
      className={panel ? "space-y-3" : "flex max-w-full flex-wrap items-center justify-end gap-1.5"}
    >
      {state === "idle" && (
        <button
          type="button"
          onClick={() => setState("choose")}
          className={panel ? `${buttonClass("primary", "md")} w-full sm:w-auto` : buttonClass("secondary", "sm")}
        >
          <Banknote className="h-4 w-4" strokeWidth={2} aria-hidden />
          سجّل أنّها سُدّدت
        </button>
      )}

      {(state === "choose" || state === "previewing") && (
        panel ? (
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-bold text-ink-soft">من أين دُفعت؟</legend>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
              <Choice
                icon={Wallet}
                title="من حسابي أو نقداً"
                hint="لا يظهر في كشف المقهى. تُعرَض المعاينة قبل الحفظ."
                busy={state === "previewing"}
                onClick={loadOwnerPreview}
              />
              <Choice
                icon={Landmark}
                title="حوالة من حساب المقهى"
                hint="تُسجَّل دفعة، وتُطابَق حين يصل كشف البنك."
                disabled={state === "previewing"}
                onClick={() => setState("confirm-bank")}
              />
            </div>
            <button type="button" onClick={back("idle")} className={buttonClass("quiet", "sm")}>تراجع</button>
          </fieldset>
        ) : (
          <>
            <span className="text-[11px] text-muted">من أين دُفعت؟</span>
            <button aria-busy={state === "previewing"} type="button" disabled={state === "previewing"} onClick={loadOwnerPreview} className={buttonClass("secondary", "sm")}>
              من حسابي أو نقداً
            </button>
            <button type="button" disabled={state === "previewing"} onClick={() => setState("confirm-bank")} className={buttonClass("secondary", "sm")}>
              حوالة من حساب المقهى
            </button>
            <button type="button" onClick={back("idle")} className={buttonClass("quiet", "sm")}>تراجع</button>
          </>
        )
      )}

      {(state === "confirm-owner" || (state === "busy" && preview)) && preview && (
        <div className={panel ? "rounded-xl border border-line bg-sunken/60 p-3.5" : "flex max-w-md flex-wrap items-center justify-end gap-1.5"}>
          <ul className={panel ? "space-y-1 text-xs leading-relaxed text-ink-soft" : "text-[11px] leading-relaxed text-ink-soft"}>
            {describePreview(preview).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <div className={panel ? "mt-3 flex flex-wrap gap-2" : "flex flex-wrap gap-1.5"}>
            <button aria-busy={state === "busy"} type="button" disabled={state === "busy"} onClick={() => run("OWNER")} className={buttonClass("primary", "sm")}>
              {ACT.paidFromOwner}
            </button>
            <button type="button" onClick={back("choose")} className={buttonClass("quiet", "sm")}>تراجع</button>
          </div>
        </div>
      )}

      {(state === "confirm-bank" || (state === "busy" && !preview)) && (
        <div className={panel ? "rounded-xl border border-line bg-sunken/60 p-3.5" : "flex flex-wrap items-center justify-end gap-1.5"}>
          <p className={panel ? "text-xs leading-relaxed text-ink-soft" : "text-[11px] text-muted"}>
            تُنشأ دفعةٌ بـ<bdi className="nums font-bold text-ink">{label}</bdi> وتُخصَّص عليها — ويمكنك التراجع من الإشعار.
          </p>
          <div className={panel ? "mt-3 flex flex-wrap gap-2" : "flex flex-wrap gap-1.5"}>
            <button aria-busy={state === "busy"} type="button" disabled={state === "busy"} onClick={() => run("BANK")} className={buttonClass("primary", "sm")}>
              {ACT.recordBankTransfer}
            </button>
            <button type="button" onClick={back("choose")} className={buttonClass("quiet", "sm")}>تراجع</button>
          </div>
        </div>
      )}

      {message && <p role="alert" className="w-full text-[11px] font-bold text-danger">{message}</p>}
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  hint,
  onClick,
  busy,
  disabled,
}: {
  icon: typeof Wallet;
  title: string;
  hint: string;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="flex min-h-11 items-start gap-3 rounded-xl border border-line bg-raised p-3 text-start transition-colors hover:border-accent-line hover:bg-accent-soft/40 disabled:opacity-60"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-soft">
        <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold">{busy ? "يحسب ما سينتقل…" : title}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">{hint}</span>
      </span>
    </button>
  );
}
