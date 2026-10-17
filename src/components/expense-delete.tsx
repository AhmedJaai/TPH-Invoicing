"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmAction, toast } from "./ui-client";
import { postJson } from "@/lib/http-client";

/**
 * «احذف هذا» — لمصروفٍ يدويّ أو من مستند.
 *
 * كان التنبيه يقول «احذف الزائد بيدك» ولا زرّ في الصفحة، فلا يُصلَح إلّا
 * بـSQL. والحذف قرارُ إنسان يُقرّ به، ويُكتب في سجلّ التدقيق باسمه. ولا
 * تراجعَ في الإشعار: لا مسارَ في الخادم يعيد قيداً حُذف.
 */
export function ExpenseDelete({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="relative z-10">
      <ConfirmAction
        label="احذف هذا القيد"
        title={`احذف «${label}»؟`}
        consequence="سيُحذف هذا القيد من المصروفات، وينخفض مصروف شهره بقدر مبلغه. لن يتأثر كشف البنك ولا المستند، ويبقى الحذف مسجلاً في سجل التدقيق باسمك."
        acknowledgement="هذا القيد زائد: العملية نفسها مقيّدة في قيد آخر، أو قُيّد هذا القيد بالخطأ"
        confirmLabel="احذفه"
        onConfirm={async () => {
          setError(null);
          const r = await postJson<{ message?: string }>("/api/expense-actual", { action: "delete", id });
          if (!r.ok) {
            setError(r.error);
            return false;
          }
          toast({ tone: "ok", title: r.data.message ?? "تم حذف القيد" });
          router.refresh();
          return true;
        }}
      />
      {error && <p role="alert" className="mt-1.5 text-[11px] font-bold text-danger">{error}</p>}
    </div>
  );
}
