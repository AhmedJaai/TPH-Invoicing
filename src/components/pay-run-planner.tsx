"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Download, MessageCircle, ShieldAlert, Wallet } from "lucide-react";
import { Money } from "./money";
import { Monogram } from "./ui";
import { Sheet, toast, Reveal } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { NETWORK_ERROR, postJson, readResponse } from "@/lib/http-client";
import { readDrawn } from "@/lib/drawn-credit";
import { INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";

/**
 * مخطِّطُ الدفعة — اختر من تدفع له، وانظر الأثر، ونزّل الملفّ، وسجّل السداد.
 *
 * الاختيارُ في المتصفّح وحده: يغيّر المجموعَ والملفَّ المنزَّل. أمّا المبالغ
 * فمن الخادم — الملفُّ يُبنى هناك من المعرّفات، والسدادُ يُكتب هناك من
 * الفواتير المفتوحة. والإقرارُ بالسداد **لا يُكتب متفائلاً**: يُنتظَر ردُّ
 * الخادم، ثمّ يظهر إشعارٌ بزرّ «تراجع» يُلغي ما كُتب إلغاءً لا حذفاً.
 */

export interface PlannerInvoice {
  id: string;
  number: string;
  date: string;
  openMinor: number;
  href: string;
}

export interface PlannerSupplier {
  supplierId: string;
  name: string;
  slug: string | null;
  totalMinor: number;
  creditAppliedMinor: number;
  /** ما عليك له كلَّه الآن — قبل هذه الدفعة. */
  owedMinor: number | null;
  account: string | null;
  accountNote: string | null;
  invoices: PlannerInvoice[];
}

export function PayRunPlanner({ month, suppliers }: { month: string; suppliers: PlannerSupplier[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(suppliers.map((s) => s.supplierId)));
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

  const chosen = useMemo(() => suppliers.filter((s) => picked.has(s.supplierId)), [suppliers, picked]);
  const totalMinor = chosen.reduce((s, x) => s + x.totalMinor, 0);
  /* من خُصم له رصيدٌ لا يُوسَم هنا: الإقرارُ يسدّد الفاتورة كلَّها لا ما حُوِّل */
  const markable = chosen.filter((s) => s.creditAppliedMinor === 0);
  const noAccount = chosen.filter((s) => !s.account);
  const missingAccount = noAccount.length;
  const allPicked = picked.size === suppliers.length;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      const res = await fetch("/api/payment-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, ...(allPicked ? {} : { suppliers: chosen.map((s) => s.supplierId) }) }),
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
    const acknowledge = only !== undefined;
    const targets = only ? markable.filter((s) => only.includes(s.supplierId)) : markable;
    const twinIds: string[] = [];
    const paymentIds: string[] = [];
    const drawn: { paymentId: string; invoiceId: string }[] = [];
    let marked = 0;
    const failures: string[] = [];
    /* مورّداً مورّداً — فيُكتب لكلٍّ قيدُه في السجلّ، ويُعرف أيُّها فشل */
    for (const s of targets) {
      const r = await postJson<{ marked?: number; totalMinor?: number; paymentIds?: string[]; drawn?: unknown; message?: string }>("/api/mark-paid", {
        invoiceIds: s.invoices.map((i) => i.id),
        supplierId: s.supplierId,
        paidOn,
        note: `دفعة ${month} — ${s.name}`,
        ...(acknowledge ? { acknowledgeTwin: true } : {}),
      });
      if (!r.ok) {
        if (r.status === 409 && r.data?.twin === true) twinIds.push(s.supplierId);
        failures.push(`${s.name}: ${r.error}`);
        continue;
      }
      marked += r.data.marked ?? 0;
      paymentIds.push(...(r.data.paymentIds ?? []));
      drawn.push(...readDrawn(r.data.drawn));
    }
    setBusy(false);
    setConfirming(false);
    setTwins(twinIds);

    if (failures.length > 0) setError(failures.join(" · "));
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
    } else if (failures.length === 0) {
      toast({ tone: "warn", title: "لم تُوسَم فاتورة — ربما سُدّدت من نافذةٍ أخرى.", body: "حدّث الصفحة لترى حالها." });
      router.refresh();
    }
  }

  return (
    <section aria-labelledby="ready-title">
      {/* ── شريطُ الاختيار: المجموعُ والأفعالُ ثابتةٌ فوق القائمة ── */}
      <div className="sticky top-14 z-10 -mx-4 mb-4 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 lg:top-[60px] lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex min-h-11 items-center gap-2.5 text-[13px] font-bold sm:min-h-0">
            <input
              type="checkbox"
              checked={allPicked}
              ref={(el) => { if (el) el.indeterminate = !allPicked && picked.size > 0; }}
              onChange={() => setPicked(allPicked ? new Set() : new Set(suppliers.map((s) => s.supplierId)))}
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
              disabled={chosen.length === 0 || exporting}
              aria-busy={exporting}
              onClick={exportFile}
              className={buttonClass("secondary")}
              title={chosen.length === 0 ? "اختر مورّداً أوّلاً" : undefined}
            >
              <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
              نزّل ملفّ التحويلات
            </button>
            <button
              type="button"
              disabled={markable.length === 0 || busy}
              onClick={() => setConfirming(true)}
              className={buttonClass("primary")}
              title={markable.length === 0 ? "اختر مورّداً لم يُخصم له رصيد" : undefined}
            >
              <Check className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              سجّل المحدَّد مسدَّداً
            </button>
          </div>
        </div>
        {missingAccount > 0 && chosen.length > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warn">
            <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            {missingAccount === 1 ? "مورّدٌ واحد" : countNoun(missingAccount, SUPPLIER)} بلا حسابٍ معروف ({noAccount.map((s) => s.name).join("، ")}) — يخرج في آخر الملفّ بقسمٍ منفصل «يحتاج حساباً» لا بين التحويلات.
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
          const on = picked.has(s.supplierId);
          const expanded = open.has(s.supplierId);
          const after = s.owedMinor === null ? null : s.owedMinor - s.totalMinor;
          return (
            <li
              key={s.supplierId}
              className={`overflow-hidden rounded-xl border bg-raised shadow-raised transition-colors ${on ? "border-accent-line" : "border-line"}`}
            >
              <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(s.supplierId)}
                  aria-label={`ادفع لـ${s.name}`}
                  className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                />
                <Monogram name={s.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">
                    {s.slug ? <Link href={`/suppliers/${s.slug}`} className="hover:text-accent">{s.name}</Link> : s.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {countNoun(s.invoices.length, INVOICE)}
                    {s.account ? <> · إلى <bdi dir="ltr" className="font-mono">{s.account}</bdi></> : <span className="text-warn"> · {s.accountNote ?? "الحسابُ غير معروف"}</span>}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-[15px] font-bold"><Money minor={s.totalMinor} /></p>
                  {after !== null && (
                    <p className="text-[11px] text-muted">
                      يبقى عليك له <Money minor={Math.max(0, after)} />
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => toggleOpen(s.supplierId)}
                  aria-expanded={expanded}
                  aria-label={expanded ? "أخفِ الفواتير" : "اعرض الفواتير"}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink sm:h-9 sm:w-9"
                >
                  <ChevronDown className={`h-4 w-4 transition-transform duration-(--dur-3) ${expanded ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
                </button>
              </div>
              {s.creditAppliedMinor > 0 && (
                <p className="border-t border-line-soft bg-accent-soft/50 px-4 py-2 text-xs leading-relaxed text-ink-soft sm:px-5">
                  خُصم <Money minor={s.creditAppliedMinor} /> رصيداً لك عنده — فحوِّل الباقي وحده، ثمّ اخصم الرصيد من ملفّه.
                  ولا يُسجَّل سدادُه من هنا.
                </p>
              )}
              <Reveal open={expanded}>
                <ul className="divide-y divide-line-soft border-t border-line-soft bg-sunken/40">
                  {s.invoices.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs sm:px-5">
                      <Link href={i.href} className="text-ink-soft hover:text-accent hover:underline">
                        <bdi className="font-mono">{i.number}</bdi> · {i.date}
                      </Link>
                      <span className="nums-col shrink-0 font-bold"><Money minor={i.openMinor} /></span>
                    </li>
                  ))}
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
              <Money minor={markable.reduce((s, x) => s + x.totalMinor, 0)} currency /> لـ{countNoun(markable.length, SUPPLIER)}
            </p>
            <p className="text-[11px] text-ink-soft">{countNoun(markable.reduce((s, x) => s + x.invoices.length, 0), INVOICE)} تصير مسدَّدة بتاريخ {dayOk ? formatDay(paidOn) : "—"}.</p>
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
          <span className={`mt-1 block text-[11px] ${dayOk ? "text-muted" : "font-bold text-danger"}`}>
            {dayOk ? "اليومُ الذي خرجت فيه الحوالة من البنك — به تُطابَق حين يصل الكشف." : "يوم التحويل لا يكون بعد اليوم."}
          </span>
        </label>
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

