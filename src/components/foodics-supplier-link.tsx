"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Unlink } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { ActionButton, toast } from "./ui-client";

/**
 * ربطُ مورّد فودكس بمورّدنا — اختيارٌ ثمّ ضغطة.
 *
 * والاقتراحُ يأتي مختاراً سلفاً بدليله (كم فاتورةً طابقت)، ولا يُكتب حتى يُضغَط:
 * الاسمُ ليس هويّة، والربطُ الخطأ يجعل فواتيرَ مورّدٍ تُقابَل بحركات آخر.
 */
export function FoodicsSupplierLink({
  foodicsSupplierId,
  linkedSupplierId,
  suggestedSupplierId,
  suppliers,
}: {
  foodicsSupplierId: string;
  linkedSupplierId: string | null;
  suggestedSupplierId: string | null;
  suppliers: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(linkedSupplierId ?? suggestedSupplierId ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(supplierId: string | null): Promise<boolean> {
    setError(null);
    const r = await postJson<{ message?: string }>("/api/foodics-link", { foodicsSupplierId, supplierId });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({ tone: "ok", title: r.data.message ?? "حفظ الربط" });
    if (supplierId === null) setChoice("");
    router.refresh();
    return true;
  }

  const unchanged = choice === (linkedSupplierId ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`link-${foodicsSupplierId}`}>المورّد عندنا</label>
      <select
        id={`link-${foodicsSupplierId}`}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="min-h-11 min-w-0 max-w-full flex-1 basis-40 rounded-lg border border-line bg-raised px-2.5 text-xs font-bold sm:min-h-9"
      >
        <option value="">— لم يربط —</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <ActionButton onAction={() => save(choice)} variant={linkedSupplierId ? "secondary" : "primary"} size="sm" disabled={choice === "" || unchanged} reason={choice === "" ? "اختر مورّداً أوّلاً" : unchanged ? "هو المربوط الآن" : undefined}>
        <Link2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        {linkedSupplierId ? "غيّر الربط" : "اربط"}
      </ActionButton>
      {linkedSupplierId && (
        <ActionButton onAction={() => save(null)} variant="quiet" size="sm" label="فكّ الربط">
          <Unlink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          فكّه
        </ActionButton>
      )}
      {error && <p role="alert" className="basis-full text-[11px] font-bold text-danger">{error}</p>}
    </div>
  );
}
