"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { formatRiyals } from "@/lib/money";
import { ActionButton, Field, MoneyInput, toast } from "./ui-client";

/**
 * حدُّ الرصيد الأدنى — يكتبه صاحبُ المقهى مرّةً، وفارغٌ يرفعه.
 * المبلغُ يُرسَل نصّاً والخادمُ يحوّله؛ والخطأُ بجانب الحقل وما كُتب يبقى.
 */
export function CashFloor({ floorMinor }: { floorMinor: number | null }) {
  const router = useRouter();
  const [amount, setAmount] = useState(floorMinor === null ? "" : formatRiyals(floorMinor));
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<boolean> {
    setError(null);
    const r = await postJson<{ message?: string }>("/api/app-setting", { setting: "cash-floor", amount });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: "ok", title: typeof r.data.message === "string" ? r.data.message : "حُفظ" });
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label="حدُّك الأدنى للرصيد (ريال)"
        error={error}
        hint="يُنبَّه حين ينزل «يبقى بعدها» تحته. اتركه فارغاً لرفعه."
        className="w-full max-w-64"
      >
        {({ invalid, ...p }) => <MoneyInput {...p} invalid={invalid} value={amount} onChange={setAmount} placeholder="مثلاً 20000" />}
      </Field>
      <ActionButton onAction={save} variant="secondary" className="mb-[1.35rem]">احفظ الحدّ</ActionButton>
    </div>
  );
}
