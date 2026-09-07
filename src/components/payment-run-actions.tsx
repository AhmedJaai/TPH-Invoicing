"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Money } from "./money";
import { buttonClass } from "./ui";
import { countNoun, INVOICE } from "@/lib/arabic";

/**
 * تسجيل أنّ الدفعة خرجت.
 *
 * كانت هذه الحلقة مفتوحة: يبني التطبيق الدفعة، ويُنزّل ملف التحويلات،
 * ثمّ لا سبيل لصاحبه أن يقول «دفعتُ». فتبقى الفواتير «لم تُسدَّد» حتى
 * الاستيراد التالي للكشف — وقد يكون بعد شهر — والتطبيق في تلك المدّة
 * يطالبه بمالٍ حوّله بيده. وقائمةُ الإقفال تأمره صراحةً: «أدرجها في
 * دفعة أوّل الشهر **أو اعتمدها مسدَّدة**» — أمرٌ بزرٍّ لم يكن موجوداً
 * إلّا داخل شاشة استيراد كشف.
 *
 * والوسم هنا **إقرارُ المالك لا مطابقةٌ بنكية** — وهكذا يُكتب في سجلّ
 * التدقيق، وهكذا يُقال له في الشاشة. فإذا وصل الكشف بعدها طابق ما طابق،
 * ولم يُنشئ سداداً ثانياً لفاتورةٍ خُصّصت.
 */
export function MarkSupplierPaid({
  supplierName,
  invoiceIds,
  totalMinor,
}: {
  supplierName: string;
  invoiceIds: string[];
  totalMinor: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function markPaid() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceIds,
          note: `سُجّلت من دفعة أوّل الشهر — ${supplierName}`,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string; marked?: number };
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "تعذّر التسجيل" });
        return;
      }
      /*
        `‎/api/mark-paid` يردّ «٢٠٠» ومعه `marked: 0` حين لا يجد فاتورةً
        مفتوحة في النطاق — كأن تكون سُدّدت من نافذةٍ أخرى بين العرض
        والضغط. وعرضُ ذلك في صندوقٍ أخضر يقول «تمّ» عن لا شيء.
      */
      if (!data.marked) {
        setResult({ ok: false, message: data.message ?? "لم تُوسَم فاتورة — راجع حالها." });
        return;
      }
      setResult({ ok: true, message: data.message ?? "سُجّل السداد" });
      setOpen(false);
      router.refresh();
    } catch {
      setResult({ ok: false, message: "تعذّر الاتصال. تحقّق من الشبكة ثمّ أعد المحاولة." });
    } finally {
      setBusy(false);
    }
  }

  if (result?.ok) {
    return (
      <p className="mt-3 rounded-lg border border-ok/40 bg-ok-bg px-3 py-2 text-xs font-bold text-ok">
        {result.message}
      </p>
    );
  }

  return (
    <div className="mt-3">
      {!open ? (
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setOpen(true)}>
          سجّل أنّها سُدِّدت
        </button>
      ) : (
        <div className="rounded-xl border border-line bg-sunken px-3 py-2.5">
          <p className="text-xs font-bold">
            يُسجَّل سدادُ <Money minor={totalMinor} /> ريالاً لـ«{supplierName}» على{" "}
            {countNoun(invoiceIds.length, INVOICE)}.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            وهذا <strong className="font-bold">إقرارٌ منك لا مطابقةٌ بنكية</strong> — يُكتب في سجلّ
            التدقيق باسمك. وحين يصل كشف البنك يطابق ما بقي، ولا يُنشئ سداداً ثانياً لفاتورةٍ خُصّصت.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("primary", "sm")} disabled={busy} onClick={markPaid}>
              {busy ? "يُسجَّل…" : "أكّد السداد"}
            </button>
            <button type="button" className={buttonClass("quiet", "sm")} disabled={busy} onClick={() => setOpen(false)}>
              تراجع
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">
          {result.message}
        </p>
      )}
    </div>
  );
}
