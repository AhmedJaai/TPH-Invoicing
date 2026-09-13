"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * «سجّل أنّها سُدّدت» — في صفحة الفواتير نفسها.
 *
 * كان الزرّ في «دفعة أوّل الشهر» وحدها، وهي تعرض شهراً واحداً: ما جاز
 * تحويلُه من الشهر المنقضي. فالفاتورة التي سُدّدت نقداً أو من شهرٍ
 * أقدم لا موضعَ لتسجيلها — تبقى «غير مسدَّدة» أبداً، ويبقى المستحقّ
 * أكبر من الحقّ.
 *
 * والفعل هو الفعل نفسه (`‎/api/mark-paid`)، لا مسارٌ ثانٍ يفعل الشيء
 * نفسه بطريقةٍ أخرى.
 *
 * ── ولا يُخترَع سداد ──
 *
 * هذا وسمٌ يدويّ: يقول صاحب العمل «هذه دفعتُها» عن علم. والخادم يُنشئ
 * الدفعة ويخصّصها، ويحرسه مؤثِّر القاعدة فلا يقبل تجاوز إجمالي
 * الفاتورة. فإن كانت مسدَّدةً أصلاً رُدَّ الطلب ولم يُكتب شيء.
 */
export function MarkInvoicePaid({
  invoiceId,
  label,
}: {
  invoiceId: string;
  label: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "done">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    setState("busy");
    setMessage(null);

    let res: Response;
    try {
      res = await fetch("/api/mark-paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceIds: [invoiceId] }),
      });
    } catch {
      /* لم يصل الطلب أصلاً — وهذا وحده عطبُ شبكة */
      setMessage("تعذّر الاتصال بالخادم — لم يصل الطلب.");
      setState("confirm");
      return;
    }

    /* يُقرأ نصّاً قبل ادّعاء أنّه JSON */
    const text = await res.text().catch(() => "");
    let data: { message?: string; error?: string; marked?: number } = {};
    try {
      data = text ? (JSON.parse(text) as typeof data) : {};
    } catch {
      /* ليس JSON */
    }

    if (!res.ok) {
      setMessage(data.error ?? `تعذّر الحفظ — ردّ الخادم بالرمز ${res.status}`);
      setState("confirm");
      return;
    }

    /*
      «٢٠٠» تقول إنّ الطلب فُهم، لا إنّ شيئاً كُتب.

      المسار يردّ `marked: 0` حين لا يجد فاتورةً تنطبق — مسدَّدةً
      أصلاً أو خارج الشرط. وقبولُ ذلك نجاحاً يرفع البند من الشاشة ولم
      يُكتب شيء، فإذا حُدِّثت الصفحة عاد كأنّ الضغطة لم تقع.
    */
    if (data.marked === 0) {
      setMessage("لم يُكتب شيء — قد تكون مسدَّدةً أصلاً.");
      setState("confirm");
      return;
    }

    setState("done");
    setMessage(data.message ?? "سُجّلت مسدَّدة");
    router.refresh();
  }

  if (state === "done") {
    return <span className="text-[11px] font-bold text-ok">✓ {message}</span>;
  }

  /*
    الصفّ كلّه رابطٌ إلى صفحة المورّد، فالضغطة على الزرّ تنتشر إليه
    فتنقل الصفحة قبل أن يقع شيء. فتُوقَف هنا لا في الصفحة — الصفحة
    خادميّة ولا يُمرَّر منها معالِجُ حدث.
  */
  const stop = (e: { stopPropagation(): void; preventDefault(): void }) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <span
      onClick={stop}
      className="inline-flex flex-wrap items-center justify-end gap-1.5"
    >
      {state === "idle" ? (
        <button
          type="button"
          onClick={() => setState("confirm")}
          className="rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium hover:border-ink-soft"
        >
          سجّل أنّها سُدّدت
        </button>
      ) : (
        <>
          {/*
            الفعل الخطير يُقرّ به لا يُسأل عنه «هل أنت متأكّد؟» — فيُعرَض
            ما سيقع بنصّه، ويكون الزرّ هو الإقرار.
          */}
          <span className="text-[11px] text-muted">تُنشأ دفعة بـ{label} وتُخصَّص عليها</span>
          <button
            type="button"
            disabled={state === "busy"}
            onClick={run}
            className="rounded-lg bg-inverse-surface px-2 py-0.5 text-[11px] font-bold text-inverse-ink disabled:opacity-50"
          >
            {state === "busy" ? "يحفظ…" : "أكّد"}
          </button>
          <button
            type="button"
            onClick={() => { setState("idle"); setMessage(null); }}
            className="text-[11px] underline"
          >
            تراجع
          </button>
        </>
      )}
      {message && <span className="text-[11px] font-bold text-danger">{message}</span>}
    </span>
  );
}
