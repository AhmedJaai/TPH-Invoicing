"use client";

import { DateChips } from "./date-chips";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronDown, CircleAlert, CircleCheck, Download, MessageCircle, RotateCcw, ShieldAlert, Wallet } from "lucide-react";
import { Money } from "./money";
import { CopyValue } from "./copy-value";
import { Monogram } from "./ui";
import { Sheet, toast, Reveal } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { NETWORK_ERROR, postJson, readResponse } from "@/lib/http-client";
import { readDrawn } from "@/lib/drawn-credit";
import { INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { formatRiyals } from "@/lib/money";
import { afterPayment } from "@/lib/payment-run";
import { EMPTY_SELECTION, parseSelection, planSupplier, rawSelection, saveSelection, subscribeSelection, type PayRunSelection } from "@/lib/pay-run-selection";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";

/**
 * مخطِّطُ الدفعة — اختر من تدفع له وأيَّ فواتيره وكم، وانظر الأثر، ونزّل الملفّ،
 * وسجّل السداد.
 *
 * الاختيارُ في المتصفّح يغيّر ما يُعرَض ويُحفَظ فيه بالشهر (تحديثُ الصفحة كان يعيد
 * «الكلّ»). أمّا المالُ فمن الخادم: الملفُّ يُبنى هناك من المعرّفات، والمبلغُ الجزئيّ
 * — الرقمُ الوحيد الذي يُكتب هنا — يُفحَص هناك على المفتوح داخل المعاملة. والإقرارُ
 * بالسداد **لا يُكتب متفائلاً**: يُنتظَر ردُّ الخادم، ثمّ يظهر إشعارٌ بزرّ «تراجع»
 * يُلغي ما كُتب إلغاءً لا حذفاً.
 */

export interface PlannerInvoice {
  id: string;
  number: string;
  date: string;
  openMinor: number;
  href: string;
  /** محجوزةٌ أدخلها المالكُ بقراره: سببُ حجزها وما كتبه سبباً. */
  owner?: { hold: string; note: string } | null;
}

export interface PlannerSupplier {
  supplierId: string;
  name: string;
  slug: string | null;
  /** رصيدٌ لنا عنده كلُّه — يُخصم ممّا اختير من فواتيره. */
  creditMinor: number;
  /** ما عليك له كلَّه الآن — قبل هذه الدفعة. */
  owedMinor: number | null;
  account: string | null;
  accountNote: string | null;
  invoices: PlannerInvoice[];
}

type RowState = "running" | "ok" | "failed";

export function PayRunPlanner({ month, suppliers }: { month: string; suppliers: PlannerSupplier[] }) {
  const router = useRouter();
  /* ما اختاره من قبل لهذا الشهر يعود بعد التحميل — ويُقال في سطرٍ ظاهر */
  const raw = useSyncExternalStore(subscribeSelection, () => rawSelection(month), () => "");
  const selection = useMemo(() => parseSelection(raw), [raw]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* يومُ الحوالة — يُسأل ولا يُفترض يومَ الضغط: به يلتقي الإقرارُ بحوالته في الكشف */
  const today = todayInRiyadh();
  const [paidOn, setPaidOn] = useState(today);
  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && paidOn <= today;
  /* مورّدون ردّهم الخادم: لهم سدادٌ بالمبلغ واليوم نفسيهما — يُسأل عنهم ولا يُسكَت */
  const [twins, setTwins] = useState<string[]>([]);
  /* حالُ كلّ مورّدٍ أثناء التسجيل — يُرى أيُّهم تمّ وأيُّهم فشل قبل أن تنتهي الحلقة */
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const stop = useRef(false);

  function change(next: PayRunSelection) {
    saveSelection(month, next);
  }

  const plans = useMemo(
    () => new Map(suppliers.map((s) => [s.supplierId, planSupplier(s, selection)])),
    [suppliers, selection],
  );
  const planOf = (s: PlannerSupplier) => plans.get(s.supplierId) ?? planSupplier(s, selection);
  const chosen = suppliers.filter((s) => planOf(s).on);
  const totalMinor = chosen.reduce((sum, s) => sum + planOf(s).payingMinor, 0);
  /* من خُصم له رصيدٌ لا يُوسَم هنا: الإقرارُ يسدّد الفاتورة لا ما حُوِّل */
  const markable = chosen.filter((s) => planOf(s).creditAppliedMinor === 0);
  const noAccount = chosen.filter((s) => !s.account);
  const missingAccount = noAccount.length;
  const allPicked = chosen.length === suppliers.length;
  const badPartial = chosen.filter((s) => planOf(s).partialError !== null);
  /* ما خرج عن «الكلّ بمبلغه» — من الحاضرين في هذه الصفحة وحدهم */
  const present = new Set(suppliers.map((s) => s.supplierId));
  const presentInvoices = new Set(suppliers.flatMap((s) => s.invoices.map((i) => i.id)));
  const skippedSuppliers = selection.skipSuppliers.filter((id) => present.has(id)).length;
  const skippedInvoices = selection.skipInvoices.filter((id) => presentInvoices.has(id)).length;
  const partialCount = chosen.filter((s) => planOf(s).partialMinor !== null).length;
  const customised = skippedSuppliers + skippedInvoices + partialCount > 0;

  function toggleSupplier(s: PlannerSupplier) {
    const skipped = selection.skipSuppliers.includes(s.supplierId);
    const ids = new Set(s.invoices.map((i) => i.id));
    change(skipped || !planOf(s).on
      /* إعادتُه تعيد فواتيرَه كلَّها — لا يبقى مختاراً بلا فاتورة */
      ? {
          ...selection,
          skipSuppliers: selection.skipSuppliers.filter((id) => id !== s.supplierId),
          skipInvoices: planOf(s).invoiceIds.length === 0 ? selection.skipInvoices.filter((id) => !ids.has(id)) : selection.skipInvoices,
        }
      : { ...selection, skipSuppliers: [...selection.skipSuppliers, s.supplierId] });
  }

  function toggleInvoice(id: string) {
    change({
      ...selection,
      skipInvoices: selection.skipInvoices.includes(id)
        ? selection.skipInvoices.filter((x) => x !== id)
        : [...selection.skipInvoices, id],
    });
  }

  function setPartial(supplierId: string, value: string) {
    const partial = { ...selection.partial };
    if (value.trim() === "") delete partial[supplierId];
    else partial[supplierId] = value;
    change({ ...selection, partial });
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /*
    التنزيلُ طلبُ POST لا رابط: التصديرُ يُكتب في سجلّ التدقيق، والرابطُ يجلبه
    المتصفّحُ مسبقاً فيُقيَّد تصديرٌ لم يقع. فيُجلَب الملفُّ ثمّ يُسلَّم للمتصفّح.
  */
  const [exporting, setExporting] = useState(false);
  async function exportFile() {
    setExporting(true);
    setError(null);
    try {
      const chosenIds = new Set(chosen.map((s) => s.supplierId));
      const exclude = suppliers
        .filter((s) => chosenIds.has(s.supplierId))
        .flatMap((s) => s.invoices.filter((i) => selection.skipInvoices.includes(i.id)).map((i) => i.id));
      const partial = chosen.flatMap((s) => {
        const minor = planOf(s).partialMinor;
        return minor === null ? [] : [{ supplierId: s.supplierId, amount: formatRiyals(minor) }];
      });
      const res = await fetch("/api/payment-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          month,
          ...(allPicked ? {} : { suppliers: [...chosenIds] }),
          ...(exclude.length > 0 ? { excludeInvoices: exclude } : {}),
          ...(partial.length > 0 ? { partial } : {}),
        }),
      });
      if (!res.ok) {
        const failed = await readResponse(res);
        setError(failed.ok ? "تعذّر التنزيل — أعد المحاولة." : failed.error);
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `payment-run-${month}.csv`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ tone: "ok", title: "نُزّل ملفّ التحويلات", body: name });
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setExporting(false);
    }
  }

  async function markPaid(only?: readonly string[]) {
    setBusy(true);
    setError(null);
    stop.current = false;
    const acknowledge = only !== undefined;
    const targets = only ? markable.filter((s) => only.includes(s.supplierId)) : markable;
    const twinIds: string[] = [];
    const paymentIds: string[] = [];
    const drawn: { paymentId: string; invoiceId: string }[] = [];
    let marked = 0;
    let attempted = 0;
    const failures: string[] = [];
    setRows({});
    /* مورّداً مورّداً — فيُكتب لكلٍّ قيدُه في السجلّ، ويُعرف أيُّها فشل */
    for (const s of targets) {
      if (stop.current) break;
      const plan = planOf(s);
      setProgress({ done: attempted, total: targets.length, current: s.name });
      setRows((prev) => ({ ...prev, [s.supplierId]: "running" }));
      const r = await postJson<{ marked?: number; totalMinor?: number; paymentIds?: string[]; drawn?: unknown; message?: string }>("/api/mark-paid", {
        invoiceIds: plan.invoiceIds,
        supplierId: s.supplierId,
        paidOn,
        note: `دفعة ${month} — ${s.name}`,
        /* الجزئيُّ بالريال نصّاً — والخادمُ يفحصه على المفتوح ويوزّعه بالأقدم أوّلاً */
        ...(plan.partialMinor !== null ? { partialAmount: formatRiyals(plan.partialMinor) } : {}),
        ...(acknowledge ? { acknowledgeTwin: true } : {}),
      });
      attempted++;
      if (!r.ok) {
        if (r.status === 409 && r.data?.twin === true) twinIds.push(s.supplierId);
        failures.push(`${s.name}: ${r.error}`);
        setRows((prev) => ({ ...prev, [s.supplierId]: "failed" }));
        continue;
      }
      setRows((prev) => ({ ...prev, [s.supplierId]: "ok" }));
      marked += r.data.marked ?? 0;
      paymentIds.push(...(r.data.paymentIds ?? []));
      drawn.push(...readDrawn(r.data.drawn));
    }
    const left = targets.length - attempted;
    setProgress(null);
    setBusy(false);
    setConfirming(false);
    setTwins(twinIds);

    const notes = [...failures, ...(left > 0 ? [`أوقفتَ التسجيل — بقي ${countNoun(left, SUPPLIER)} لم يُسجَّل`] : [])];
    if (notes.length > 0) setError(notes.join(" · "));
    if (marked > 0) {
      toast({
        tone: "ok",
        title: `سُجّل سدادُ ${countNoun(marked, INVOICE)}`,
        body: "إقرارٌ منك لا مطابقةٌ بنكية — وحين يصل الكشف يطابق ما بقي.",
        undo: paymentIds.length + drawn.length > 0 ? {
          run: async () => {
            const u = await postJson<{ message: string }>("/api/mark-paid/undo", { paymentIds, drawn });
            if (u.ok) router.refresh();
            return u.ok;
          },
        } : undefined,
      });
      router.refresh();
    } else if (notes.length === 0) {
      toast({ tone: "warn", title: "لم تُوسَم فاتورة — ربما سُدّدت من نافذةٍ أخرى.", body: "حدّث الصفحة لترى حالها." });
      router.refresh();
    }
  }

  async function restoreHold(invoice: PlannerInvoice) {
    const r = await postJson<{ message?: string }>("/api/payment-run/hold", { month, invoiceIds: [invoice.id], action: "restore" });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({ tone: "ok", title: `أُعيدت فاتورة ${invoice.number} إلى الحجز`, body: "خرجت من الدفعة ومن ملفّ التحويلات." });
    router.refresh();
  }

  /* لِمَ الزرّ معطَّل — يُكتب سطراً يُرى على الجوّال، لا تلميحاً تحت الفأرة وحده */
  const blocked = chosen.length === 0
    ? "لم تختر أحداً — اختر مورّداً أوّلاً."
    : badPartial.length > 0
      ? `صحّح المبلغ الجزئيّ لـ${badPartial.map((s) => s.name).join("، ")} أو امسحه.`
      : null;
  const markBlocked = blocked ?? (markable.length === 0 ? "كلُّ من اخترتَهم خُصم لهم رصيد — يُسجَّل سدادُهم من ملفّ المورّد." : null);
  const markTotal = markable.reduce((sum, s) => sum + planOf(s).payingMinor, 0);

  return (
    <section aria-labelledby="ready-title">
      {/* ── شريطُ الاختيار: المجموعُ والأفعالُ ثابتةٌ فوق القائمة ── */}
      <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-[60px] lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex min-h-11 items-center gap-2.5 text-[13px] font-bold">
            <input
              type="checkbox"
              checked={allPicked}
              ref={(el) => { if (el) el.indeterminate = !allPicked && chosen.length > 0; }}
              onChange={() => change(allPicked
                ? { ...selection, skipSuppliers: suppliers.map((s) => s.supplierId) }
                : { ...selection, skipSuppliers: [], skipInvoices: selection.skipInvoices.filter((id) => !presentInvoices.has(id)) })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span id="ready-title">الكلّ</span>
          </label>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted">
              {chosen.length === 0 ? "لم تختر أحداً" : `محدَّدٌ للتحويل — ${countNoun(chosen.length, SUPPLIER)}`}
            </p>
            <p className="text-xl font-bold leading-tight"><Money minor={totalMinor} currency /></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={blocked !== null || exporting}
              aria-busy={exporting}
              onClick={exportFile}
              className={buttonClass("secondary")}
            >
              <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
              نزّل ملفّ التحويلات
            </button>
            <button
              type="button"
              disabled={markBlocked !== null || busy}
              onClick={() => setConfirming(true)}
              className={buttonClass("primary")}
            >
              <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              سجّل المحدَّد مسدَّداً
            </button>
          </div>
        </div>
        {markBlocked && <p className="mt-2 text-[11px] text-ink-soft">{markBlocked}</p>}
        {customised && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-soft">
            <span>
              غيّرتَ الدفعة:
              {skippedSuppliers > 0 && <> استثنيتَ {countNoun(skippedSuppliers, SUPPLIER)}</>}
              {skippedInvoices > 0 && <>{skippedSuppliers > 0 ? " و" : " استثنيتَ "}{countNoun(skippedInvoices, INVOICE)}</>}
              {partialCount > 0 && <>{skippedSuppliers + skippedInvoices > 0 ? " · " : " "}مبلغٌ جزئيّ لـ{countNoun(partialCount, SUPPLIER)}</>}
              {" "}— واختيارُك محفوظٌ على هذا الجهاز.
            </span>
            <button type="button" onClick={() => change(EMPTY_SELECTION)} className="inline-flex min-h-8 items-center gap-1 font-bold text-accent hover:underline">
              <RotateCcw className="h-3 w-3" strokeWidth={2} aria-hidden />
              أعِد الكلّ بمبلغه
            </button>
          </p>
        )}
        {missingAccount > 0 && chosen.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warn">
            <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {missingAccount === 1 ? "مورّدٌ واحد" : countNoun(missingAccount, SUPPLIER)} بلا حسابٍ معروف ({noAccount.map((s) => s.name).join("، ")}) — يخرج في آخر الملفّ بقسمٍ منفصل «يحتاج حساباً» لا بين التحويلات.
          </p>
        )}
        {progress && (
          <p role="status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-ink-soft">
            <span>يُسجَّل <span className="nums">{progress.done + 1}</span> من <span className="nums">{progress.total}</span> — {progress.current}</span>
            {progress.total - progress.done > 1 && (
              <button type="button" onClick={() => { stop.current = true; }} className="min-h-8 font-bold text-accent hover:underline">
                أوقف بعد الحاليّ
              </button>
            )}
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-xs font-bold text-danger">{error}</p>}
        {twins.length > 0 && (
          <button type="button" disabled={busy} aria-busy={busy} onClick={() => markPaid(twins)} className={`${buttonClass("secondary", "sm")} mt-2`}>
            سدادٌ آخر حقّاً — سجّل {countNoun(twins.length, SUPPLIER)}
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {suppliers.map((s) => {
          const plan = planOf(s);
          const expanded = open.has(s.supplierId);
          const after = afterPayment(s.owedMinor, plan.payingMinor);
          const state = rows[s.supplierId];
          const ownerCount = s.invoices.filter((i) => i.owner && plan.invoiceIds.includes(i.id)).length;
          return (
            <li
              key={s.supplierId}
              className={`overflow-hidden rounded-xl border bg-raised shadow-raised transition-colors ${plan.on ? "border-accent-line" : "border-line"}`}
            >
              <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-5 sm:py-3">
                {/* المربّعُ والحرفُ في تسميةٍ واحدة: هدفُ لمسٍ ٤٤ بكسلاً، لا ١٦ بجانب رابط */}
                <label className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={plan.on}
                    disabled={busy}
                    onChange={() => toggleSupplier(s)}
                    aria-label={`ادفع لـ${s.name}`}
                    className="ms-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <Monogram name={s.name} />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[14px] font-bold">
                    {s.slug ? <Link href={`/suppliers/${s.slug}`} className="truncate hover:text-accent">{s.name}</Link> : <span className="truncate">{s.name}</span>}
                    {state === "ok" && <CircleCheck className="h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-label="سُجّل" />}
                    {state === "failed" && <CircleAlert className="h-4 w-4 shrink-0 text-danger" strokeWidth={2} aria-label="لم يُسجَّل" />}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {plan.skippedInvoices > 0
                      ? <><span className="nums">{plan.invoiceIds.length}</span> من {countNoun(s.invoices.length, INVOICE)}</>
                      : countNoun(s.invoices.length, INVOICE)}
                    {!s.account && <span className="text-warn"> · {s.accountNote ?? "الحسابُ غير معروف"}</span>}
                  </p>
                  {/* الحسابُ والمبلغُ يُنسخان بضغطة إلى تطبيق البنك — بصيغته، بلا فواصل */}
                  {s.account && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                      <CopyValue value={s.account} label="الحساب" className="min-h-8">
                        <bdi dir="ltr" className="font-mono">{s.account}</bdi>
                      </CopyValue>
                      {plan.on && (
                        <CopyValue value={formatRiyals(plan.payingMinor)} label="المبلغ" className="min-h-8">
                          انسخ المبلغ
                        </CopyValue>
                      )}
                    </p>
                  )}
                  {ownerCount > 0 && (
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-warn">
                      <ShieldAlert className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
                      فيها {countNoun(ownerCount, INVOICE)} محجوزة أدخلتَها بقرارك
                    </p>
                  )}
                </div>
                <div className="text-end">
                  <p className={`text-[15px] font-bold ${plan.on ? "" : "text-muted"}`}><Money minor={plan.on ? plan.payingMinor : plan.fullMinor} /></p>
                  {!plan.on ? (
                    <p className="text-[11px] text-muted">خارج هذه الدفعة</p>
                  ) : (
                    <>
                      {plan.partialMinor !== null && (
                        <p className="text-[11px] font-bold text-warn">جزءٌ من <Money minor={plan.fullMinor} /></p>
                      )}
                      {after.state === "remaining" && <p className="text-[11px] text-muted">يبقى عليك له <Money minor={after.minor} /></p>}
                      {after.state === "settled" && <p className="text-[11px] text-muted">لا يبقى عليك له شيء</p>}
                      {/* الزيادةُ تُقال بمبلغها — كانت تُقصّ إلى «يبقى 0.00» */}
                      {after.state === "over" && (
                        <p className="text-[11px] font-bold text-warn">
                          تدفع زيادةً <Money minor={after.minor} /> — تصير رصيداً لك عنده
                        </p>
                      )}
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleOpen(s.supplierId)}
                  aria-expanded={expanded}
                  aria-label={expanded ? "أخفِ الفواتير" : "اعرض الفواتير واختر منها"}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink sm:h-9 sm:w-9"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-(--dur-3) ${expanded ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
                </button>
              </div>
              {plan.on && after.state === "over" && (
                <p className="border-t border-line-soft bg-warn-bg px-4 py-2 text-xs leading-relaxed text-ink-soft sm:px-5">
                  ما عليك له الآن <Money minor={s.owedMinor ?? 0} /> وهذه الدفعة <Money minor={plan.payingMinor} />.
                  قد يكون سدادٌ أو إشعارٌ دائن قُيِّد بعد بناء الدفعة — راجع{" "}
                  {s.slug ? <Link href={`/suppliers/${s.slug}`} className="font-bold text-accent hover:underline">ملفَّه</Link> : "ملفَّه"}{" "}
                  قبل التحويل، أو استثنِ فاتورةً أو اكتب مبلغاً جزئيّاً.
                </p>
              )}
              {plan.on && plan.creditAppliedMinor > 0 && (
                <p className="border-t border-line-soft bg-accent-soft/50 px-4 py-2 text-xs leading-relaxed text-ink-soft sm:px-5">
                  خُصم <Money minor={plan.creditAppliedMinor} /> رصيداً لك عنده — فحوِّل الباقي وحده، ثمّ اخصم الرصيد من ملفّه.
                  ولا يُسجَّل سدادُه من هنا.
                </p>
              )}
              <Reveal open={expanded}>
                <ul className="divide-y divide-line-soft border-t border-line-soft bg-sunken/40">
                  {s.invoices.map((i) => {
                    const included = !selection.skipInvoices.includes(i.id);
                    return (
                      <li key={i.id} className="px-3 py-1 text-xs sm:px-5">
                        <div className="flex items-center justify-between gap-3">
                          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={included}
                              disabled={busy}
                              onChange={() => toggleInvoice(i.id)}
                              aria-label={`ادفع فاتورة ${i.number}`}
                              className="ms-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                            />
                            <span className={`truncate ${included ? "text-ink-soft" : "text-muted line-through"}`}>
                              <bdi className="font-mono">{i.number}</bdi> · {i.date}
                            </span>
                          </label>
                          <Link href={i.href} className="shrink-0 text-[11px] font-bold text-accent hover:underline">افتحها</Link>
                          <span className={`nums-col shrink-0 font-bold ${included ? "" : "text-muted"}`}><Money minor={i.openMinor} /></span>
                        </div>
                        {i.owner && (
                          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warn-bg px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                            <span className="min-w-0 flex-1">
                              <b className="text-warn">بقرارك وهي محجوزة:</b> {i.owner.hold}. سببُك: «{i.owner.note}»
                            </span>
                            <button type="button" disabled={busy} onClick={() => restoreHold(i)} className="min-h-8 shrink-0 font-bold text-accent hover:underline">
                              أعِدها إلى الحجز
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {plan.on && (
                    <li className="px-4 py-3 sm:px-5">
                      <label className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                        <span className="font-bold">ادفع جزءاً فقط</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          dir="ltr"
                          value={selection.partial[s.supplierId] ?? ""}
                          disabled={busy}
                          onChange={(e) => setPartial(s.supplierId, e.target.value)}
                          placeholder={formatRiyals(plan.fullMinor)}
                          aria-invalid={plan.partialError !== null}
                          aria-label={`مبلغٌ جزئيّ لـ${s.name} بالريال`}
                          className="nums h-11 w-36 rounded-lg border border-line-input bg-raised px-3 text-sm sm:h-9"
                        />
                        <span className={plan.partialError ? "font-bold text-danger" : "text-muted"}>
                          {plan.partialError
                            ? <>{plan.partialError} (<Money minor={plan.fullMinor} />)</>
                            : plan.partialMinor !== null
                              ? <>يبقى من هذه الدفعة <Money minor={plan.fullMinor - plan.partialMinor} /> — ويُسدَّد الأقدمُ أوّلاً</>
                              : "اتركه فارغاً لتدفع المختارَ كلَّه"}
                        </span>
                      </label>
                    </li>
                  )}
                </ul>
              </Reveal>
            </li>
          );
        })}
      </ul>

      <Sheet
        open={confirming}
        onClose={() => { if (!busy) setConfirming(false); }}
        title="سجّل أنّها سُدّدت"
        description="إقرارٌ منك لا مطابقةٌ بنكية — يُكتب في سجلّ التدقيق باسمك."
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("quiet")} disabled={busy} onClick={() => setConfirming(false)}>تراجع</button>
            <button aria-busy={busy} type="button" className={buttonClass("primary")} disabled={busy || !dayOk} onClick={() => markPaid()}>
              أكّد السداد
            </button>
          </>
        }
      >
        <div className="flex items-center gap-3 rounded-xl bg-accent-soft px-4 py-3">
          <Wallet className="h-5 w-5 text-accent" strokeWidth={2} aria-hidden />
          <div>
            <p className="text-sm font-bold">
              <Money minor={markTotal} currency /> لـ{countNoun(markable.length, SUPPLIER)}
            </p>
            <p className="text-[11px] text-ink-soft">
              {countNoun(markable.reduce((sum, x) => sum + planOf(x).invoiceIds.length, 0), INVOICE)} يُسجَّل سدادُها بتاريخ {dayOk ? formatDay(paidOn) : "—"}
              {markable.some((x) => planOf(x).partialMinor !== null) ? " — والجزئيُّ يسدّد الأقدمَ أوّلاً ويُبقي الباقي مفتوحاً." : "."}
            </p>
          </div>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-bold">يوم التحويل</span>
          <input
            type="date"
            dir="ltr"
            value={paidOn}
            max={today}
            disabled={busy}
            onChange={(e) => setPaidOn(e.target.value)}
            aria-invalid={!dayOk}
            className="nums mt-1 block h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:h-10"
          />
          <DateChips value={paidOn} onPick={setPaidOn} disabled={busy} max={today} />
          <span className={`mt-1 block text-[11px] ${dayOk ? "text-muted" : "font-bold text-danger"}`}>
            {dayOk ? "اليومُ الذي خرجت فيه الحوالة من البنك — به تُطابَق حين يصل الكشف." : "يوم التحويل لا يكون بعد اليوم."}
          </span>
        </label>
        {progress && (
          <p role="status" className="mt-3 text-xs font-bold text-ink-soft">
            يُسجَّل <span className="nums">{progress.done + 1}</span> من <span className="nums">{progress.total}</span> — {progress.current}
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          حين يصل كشف البنك يطابق ما بقي، ولا يُنشئ سداداً ثانياً لفاتورةٍ خُصّصت. وإن ضغطتَ خطأً فزرُّ «تراجع» في الإشعار يُلغي ما كُتب.
        </p>
        {chosen.length > markable.length && (
          <p className="mt-2 text-xs text-warn">
            {countNoun(chosen.length - markable.length, SUPPLIER)} خُصم لهم رصيد — لا يُسجَّلون هنا.
          </p>
        )}
      </Sheet>
    </section>
  );
}

/** رسالةُ واتساب جاهزة لمورّدٍ محجوزةٍ فواتيره — رابطٌ يفتح واتساب ولا يُرسل شيئاً وحده. */
export function WhatsAppLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={buttonClass("secondary", "sm")}>
      <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      رسالة واتساب جاهزة
    </a>
  );
}

/**
 * «أدخلها في الدفعة» — قرارُ صاحب المال في فواتيرَ محجوزة لمورّدٍ واحد.
 *
 * الحجزُ تنبيهٌ لا منع: يُقال ما يُعرَّض (الضريبةُ بمبلغها كما حسبها الخادم)،
 * ويُكتب السبب، ثمّ تدخل الفواتيرُ الدفعةَ موسومةً «بقرارك» وتُرَدّ منها متى شاء.
 */
export function HoldOverride({
  month, supplierName, invoiceIds, openMinor, vatAtRiskMinor, vatAtRiskUnknown,
}: {
  month: string;
  supplierName: string;
  invoiceIds: string[];
  openMinor: number;
  /** ضريبةٌ لا تُخصم يقيناً — من الخادم. */
  vatAtRiskMinor: number;
  /** فواتيرُ لم تُقرأ ضريبتُها — تُعَدّ ولا تُجمَع صفراً. */
  vatAtRiskUnknown: number;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteOk = note.trim().length >= 3;

  async function include() {
    setBusy(true);
    setError(null);
    const r = await postJson<{ message?: string }>("/api/payment-run/hold", { month, invoiceIds, action: "include", note: note.trim() });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAsking(false);
    toast({
      tone: "warn",
      title: `دخلت فواتيرُ ${supplierName} الدفعةَ بقرارك`,
      body: "هي الآن بين الجاهز موسومةً «بقرارك» — ومن هناك تُعاد إلى الحجز.",
      undo: {
        label: "أعِدها إلى الحجز",
        run: async () => {
          const u = await postJson<{ message?: string }>("/api/payment-run/hold", { month, invoiceIds, action: "restore" });
          if (u.ok) router.refresh();
          return u.ok;
        },
      },
    });
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setAsking(true)} className={buttonClass("secondary", "sm")}>
        <Wallet className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        أدخلها في الدفعة
      </button>
      <Sheet
        open={asking}
        onClose={() => { if (!busy) setAsking(false); }}
        title={`ادفع لـ${supplierName} وهي محجوزة`}
        description="قرارُك يُحفَظ بسببه في سجلّ التدقيق، والتنبيهُ يبقى ظاهراً في الدفعة."
        size="sm"
        footer={
          <>
            <button type="button" className={buttonClass("quiet")} disabled={busy} onClick={() => setAsking(false)}>إلغاء</button>
            <button type="button" aria-busy={busy} className={buttonClass("primary")} disabled={busy || !noteOk} onClick={include}>
              أدخلها في الدفعة
            </button>
          </>
        }
      >
        <div className="rounded-xl bg-warn-bg px-4 py-3 text-xs leading-relaxed text-ink-soft">
          <p className="text-sm font-bold text-ink">
            <Money minor={openMinor} currency /> على {countNoun(invoiceIds.length, INVOICE)}
          </p>
          <p className="mt-1">
            السدادُ قبل الفاتورة الضريبيّة الصحيحة يُفقدك ورقةَ التفاوض.
            {vatAtRiskMinor > 0 && <> وضريبةُ مدخلاتٍ <b><Money minor={vatAtRiskMinor} /></b> لا تُخصم ما لم تصل الفاتورةُ الصحيحة.</>}
            {vatAtRiskUnknown > 0 && <> و{countNoun(vatAtRiskUnknown, INVOICE)} لم تُقرأ ضريبتُها — المعرّضُ منها غير معروف.</>}
          </p>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-bold">لماذا تدفعها الآن؟</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
            disabled={busy}
            placeholder="مثلاً: لا يسلّم قبل السداد"
            className="mt-1 block w-full rounded-lg border border-line-input bg-raised px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted">يُعرَض بجانب الفاتورة في الدفعة وفي ملفّ التحويلات «بقرار المالك».</span>
        </label>
        {error && <p role="alert" className="mt-2 text-xs font-bold text-danger">{error}</p>}
      </Sheet>
    </>
  );
}

