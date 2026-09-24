"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Download, MessageCircle, ShieldAlert, Wallet } from "lucide-react";
import { Money } from "./money";
import { Monogram } from "./ui";
import { Sheet, toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { postJson } from "@/lib/http-client";
import { INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";

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

  const chosen = useMemo(() => suppliers.filter((s) => picked.has(s.supplierId)), [suppliers, picked]);
  const totalMinor = chosen.reduce((s, x) => s + x.totalMinor, 0);
  /* من خُصم له رصيدٌ لا يُوسَم هنا: الإقرارُ يسدّد الفاتورة كلَّها لا ما حُوِّل */
  const markable = chosen.filter((s) => s.creditAppliedMinor === 0);
  const missingAccount = chosen.filter((s) => !s.account).length;
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

  const exportHref = `/api/payment-run?month=${month}${allPicked ? "" : `&suppliers=${chosen.map((s) => s.supplierId).join(",")}`}`;

  async function markPaid() {
    setBusy(true);
    setError(null);
    const paymentIds: string[] = [];
    let marked = 0;
    const failures: string[] = [];
    /* مورّداً مورّداً — فيُكتب لكلٍّ قيدُه في السجلّ، ويُعرف أيُّها فشل */
    for (const s of markable) {
      const r = await postJson<{ marked?: number; totalMinor?: number; paymentIds?: string[]; message?: string }>("/api/mark-paid", {
        invoiceIds: s.invoices.map((i) => i.id),
        supplierId: s.supplierId,
        note: `دفعة ${month} — ${s.name}`,
      });
      if (!r.ok) {
        failures.push(`${s.name}: ${r.error}`);
        continue;
      }
      marked += r.data.marked ?? 0;
      paymentIds.push(...(r.data.paymentIds ?? []));
    }
    setBusy(false);
    setConfirming(false);

    if (failures.length > 0) setError(failures.join(" · "));
    if (marked > 0) {
      toast({
        tone: "ok",
        title: `سُجّل سدادُ ${countNoun(marked, INVOICE)}`,
        body: "إقرارٌ منك لا مطابقةٌ بنكية — وحين يصل الكشف يطابق ما بقي.",
        undo: paymentIds.length > 0 ? {
          run: async () => {
            const u = await postJson<{ message: string }>("/api/mark-paid/undo", { paymentIds });
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
            {chosen.length > 0 ? (
              <a href={exportHref} className={buttonClass("secondary")} download>
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
                نزّل ملفّ التحويلات
              </a>
            ) : (
              <span className={`${buttonClass("secondary")} pointer-events-none opacity-50`} aria-disabled="true" title="اختر مورّداً أوّلاً">
                <Download className="h-4 w-4" strokeWidth={2} aria-hidden />
                نزّل ملفّ التحويلات
              </span>
            )}
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
            {missingAccount === 1 ? "مورّدٌ واحد" : countNoun(missingAccount, SUPPLIER)} بلا حسابٍ معروف — يخرج في الملفّ فارغاً بتنبيه، فأكمِله عند البنك.
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-xs font-bold text-danger">{error}</p>}
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
                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
                </button>
              </div>
              {s.creditAppliedMinor > 0 && (
                <p className="border-t border-line-soft bg-accent-soft/50 px-4 py-2 text-xs leading-relaxed text-ink-soft sm:px-5">
                  خُصم <Money minor={s.creditAppliedMinor} /> رصيداً لك عنده — فحوِّل الباقي وحده، ثمّ اخصم الرصيد من ملفّه.
                  ولا يُسجَّل سدادُه من هنا.
                </p>
              )}
              {expanded && (
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
              )}
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
            <button type="button" className={buttonClass("primary")} disabled={busy} onClick={markPaid}>
              {busy ? "يُسجَّل…" : "أكّد السداد"}
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
            <p className="text-[11px] text-ink-soft">{countNoun(markable.reduce((s, x) => s + x.invoices.length, 0), INVOICE)} تصير مسدَّدة اليوم.</p>
          </div>
        </div>
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

