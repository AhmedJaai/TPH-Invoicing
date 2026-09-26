"use client";

import { useId } from "react";
import { Monogram } from "./ui";
import { suggestSuppliers, type SuggestibleSupplier } from "@/lib/supplier-suggest";

/**
 * «أيّ مورّد؟» — المقترَحُ من نصّ البنك أوّلاً بضغطة، ثمّ القائمةُ كلُّها.
 *
 * كان سؤالاً بقائمةٍ منسدلة فيها كلُّ المورّدين بترتيب الحروف في موضعين
 * (طابورُ البنك ومراجعةُ الحركات) وبشكلين. فصار واحداً. والاقتراحُ يقول
 * سببَه (الاسمُ في نصّ البنك)، ولا يُكتب شيءٌ حتى يُضغط زرُّ الحفظ.
 */
export function SupplierPicker({
  text,
  suppliers,
  value,
  onChange,
  disabled = false,
  chipsOnly = false,
}: {
  /** نصُّ الحركة كما في الكشف — منه يُقترَح. */
  text: string;
  suppliers: readonly SuggestibleSupplier[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** المقترَحُ وحده، بلا القائمة — قبل أن يُختار أنّها سدادُ مورّد. */
  chipsOnly?: boolean;
}) {
  const id = useId();
  const suggested = suggestSuppliers(text, suppliers);
  return (
    <div className="mt-3 space-y-2">
      {suggested.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-muted">لعلّه — اسمُه في نصّ البنك:</span>
          {suggested.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={disabled}
              aria-pressed={value === s.id}
              onClick={() => onChange(s.id)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors sm:min-h-8 ${
                value === s.id
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-raised text-ink hover:border-accent-line hover:bg-hover"
              }`}
            >
              <Monogram name={s.nameAr} className="h-5 w-5 text-[10px]" />
              {s.nameAr}
            </button>
          ))}
        </div>
      )}
      {!chipsOnly && <label htmlFor={id} className="block">
        <span className="text-[11px] font-bold text-muted">{suggested.length > 0 ? "أو اختر من الكلّ" : "أيّ مورّد؟"}</span>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-10"
        >
          <option value="">اختر…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.nameAr}</option>
          ))}
        </select>
      </label>}
    </div>
  );
}
