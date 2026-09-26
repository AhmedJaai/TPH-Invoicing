"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Monogram } from "./ui";
import { ActionButton, toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";
import { postJson } from "@/lib/http-client";
import { suggestSuppliers, type SuggestibleSupplier } from "@/lib/supplier-suggest";

/**
 * «أيّ مورّد؟» — المقترَحُ من نصّ البنك أوّلاً بضغطة، ثمّ القائمةُ كلُّها.
 *
 * كان سؤالاً بقائمةٍ منسدلة فيها كلُّ المورّدين بترتيب الحروف في موضعين
 * (طابورُ البنك ومراجعةُ الحركات) وبشكلين. فصار واحداً. والاقتراحُ يقول
 * سببَه (الاسمُ في نصّ البنك)، ولا يُكتب شيءٌ حتى يُضغط زرُّ الحفظ.
 *
 * **ومورّدٌ جديد يُنشأ في مكانه** (`canCreate`، لمن يملك `supplier:edit`).
 * كان استيرادُ الكشف يجد مستفيداً لا يعرفه ولا يُعطي إلّا القائمةَ المسجَّلة —
 * فيذهب صاحبُ العمل إلى صفحة المورّدين ويعود ويبدأ من جديد. والاسمُ يُقترح
 * من نصّ البنك (`createName`)، و`/api/supplier` يُعيد القائمَ إن كان مسجَّلاً.
 */
export function SupplierPicker({
  text,
  suppliers,
  value,
  onChange,
  disabled = false,
  chipsOnly = false,
  canCreate = false,
  createName = "",
}: {
  /** نصُّ الحركة كما في الكشف — منه يُقترَح. */
  text: string;
  suppliers: readonly SuggestibleSupplier[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  /** المقترَحُ وحده، بلا القائمة — قبل أن يُختار أنّها سدادُ مورّد. */
  chipsOnly?: boolean;
  /** «مورّدٌ جديد» بجانب القائمة — لمن يملك إنشاء المورّدين. */
  canCreate?: boolean;
  /** الاسمُ المقترَح للمورّد الجديد — من نصّ البنك. */
  createName?: string;
}) {
  const id = useId();
  /* ما أُنشئ هنا يدخل القائمةَ فوراً — لا ينتظر تحديثَ الصفحة */
  const [added, setAdded] = useState<SuggestibleSupplier[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const all = [...suppliers, ...added.filter((a) => !suppliers.some((s) => s.id === a.id))];
  const suggested = suggestSuppliers(text, all);

  async function create(): Promise<boolean> {
    const nameAr = name.trim();
    if (nameAr.length < 2) return false;
    setError(null);
    const r = await postJson<{ existed?: boolean; supplier: { id: string; nameAr: string; slug?: string } }>("/api/supplier", { nameAr });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    const s = r.data.supplier;
    setAdded((xs) => [...xs, { id: s.id, nameAr: s.nameAr, slug: s.slug ?? null }]);
    onChange(s.id);
    setCreating(false);
    toast({
      tone: "ok",
      title: r.data.existed ? "مسجَّلٌ من قبل — اختير" : "أُنشئ المورّد واختير",
      body: s.nameAr,
    });
    return true;
  }
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
          {all.map((s) => (
            <option key={s.id} value={s.id}>{s.nameAr}</option>
          ))}
        </select>
      </label>}
      {!chipsOnly && canCreate && !creating && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { setName(createName.trim()); setCreating(true); setError(null); }}
          className={buttonClass("quiet", "sm")}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          ليس في القائمة؟ مورّدٌ جديد
        </button>
      )}
      {!chipsOnly && creating && (
        <div className="rounded-lg border border-line-soft bg-sunken/50 p-2.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[10rem] flex-1">
              <span className="text-[11px] font-bold text-muted">اسمُ المورّد بالعربية</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void create(); }
                  if (e.key === "Escape") { e.preventDefault(); setCreating(false); }
                }}
                autoFocus
                dir="auto"
                className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-9"
              />
            </label>
            <ActionButton variant="primary" size="sm" disabled={name.trim().length < 2} reason="اكتب الاسم — حرفان على الأقلّ" onAction={create}>
              أنشئه واختره
            </ActionButton>
            <button type="button" onClick={() => setCreating(false)} className={buttonClass("quiet", "sm")}>تراجع</button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            وتُكمَل بياناتُه (الرقمُ الضريبيّ، واسمُ مجلّده في الدرايف) من ملفّه بعدها.
          </p>
          {error && <p role="alert" className="mt-1 text-[11px] font-bold text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
