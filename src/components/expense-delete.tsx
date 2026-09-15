"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmAction } from "./ui-client";
import { postJson } from "@/lib/http-client";

/**
 * «احذف هذا» — لمصروفٍ يدويّ أو من مستند.
 *
 * كان التنبيه يقول «احذف الزائد بيدك» ولا زرّ في الصفحة، فلا يُصلَح إلّا
 * بـSQL. والحذف قرارُ إنسان يُقرّ به، ويُكتب في سجلّ التدقيق باسمه.
 */
export function ExpenseDelete({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div>
      <ConfirmAction
        label="احذف هذا"
        title={`احذف «${label}»؟`}
        consequence="يُحذف هذا القيد من المصروفات فينخفض مصروف شهره بقدره. ولا يُمَسّ كشف البنك ولا المستند، ويبقى أثر الحذف في سجلّ التدقيق باسمك."
        acknowledgement="هذا القيد زائد — الحدث نفسه مقيَّدٌ في غيره، أو قُيّد خطأً"
        confirmLabel="احذفه"
        onConfirm={async () => {
          setError(null);
          const r = await postJson<{ message?: string }>("/api/expense-actual", { action: "delete", id });
          if (!r.ok) {
            setError(r.error);
            return false;
          }
          setDone(r.data.message ?? "حُذف القيد");
          router.refresh();
          return true;
        }}
      />
      {error && <p role="alert" className="mt-1.5 text-[11px] font-bold text-danger">{error}</p>}
      {done && <p role="status" className="mt-1.5 text-[11px] font-bold text-ok">{done}</p>}
    </div>
  );
}
