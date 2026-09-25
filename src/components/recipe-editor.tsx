"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { Plus, Trash2 } from "lucide-react";
import { buttonClass } from "./ui";
import { Sheet, toast } from "./ui-client";

/**
 * محرّرُ الوصفة — ولا تُعدَّل نسخةٌ في مكانها أبداً.
 *
 * كلُّ حفظٍ **نسخةٌ جديدة بتاريخ سريان**. فتقريرُ الأسبوع الماضي يبقى
 * محسوباً بالجرعة التي كانت عاملةً فيه. ولو عُدّلت النسخةُ في مكانها
 * لتغيّر بأثرٍ رجعيّ كلُّ تقريرٍ حُسب بها — وهو ما يجعل «التقرير
 * التاريخيّ» لفظاً بلا معنى.
 */
export interface IngredientOption {
  id: string;
  name: string;
  baseUnit: string;
  unitLabel: string;
}

interface Line {
  productId: string;
  quantity: string;
  unit: string;
  prepLossPercent: string;
}

const UNITS: { value: string; label: string }[] = [
  { value: "G", label: "جرام" },
  { value: "KG", label: "كيلو" },
  { value: "ML", label: "مليلتر" },
  { value: "L", label: "لتر" },
  { value: "PIECE", label: "حبّة" },
  { value: "PACK", label: "عبوة" },
];

export function RecipeEditor({
  menuProducts,
  ingredients,
  defaultFrom,
  variant = "primary",
}: {
  menuProducts: { id: string; name: string }[];
  ingredients: IngredientOption[];
  defaultFrom: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menuProductId, setMenuProductId] = useState(menuProducts[0]?.id ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(defaultFrom);
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "", unit: "G", prepLossPercent: "" }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const ready = menuProductId && effectiveFrom
    && lines.some((l) => l.productId && l.quantity.trim() !== "");

  function setLine(at: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === at ? { ...l, ...patch } : l)));
  }

  async function save() {
    setBusy(true);
    setFailed(false);
    setMessage(null);

    const r = await postJson("/api/inventory/recipe", {
      action: "save",
      menuProductId,
      effectiveFrom,
      activate: true,
      ingredients: lines
        .filter((l) => l.productId && l.quantity.trim() !== "")
        .map((l) => ({
          productId: l.productId,
          quantity: l.quantity.trim(),
          unit: l.unit,
          prepLossPercent: l.prepLossPercent.trim() || null,
        })),
    });

    setBusy(false);
    if (!r.ok) {
      setFailed(true);
      setMessage(r.error);
      return;
    }
    setMessage(null);
    setLines([{ productId: "", quantity: "", unit: "G", prepLossPercent: "" }]);
    setOpen(false);
    toast({ tone: "ok", title: String(r.data.message ?? "حُفظت الوصفة وفُعِّلت.") });
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, "sm")}>
        <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
        وصفةٌ جديدة
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title="وصفةٌ جديدة أو نسخةٌ جديدة"
        description="غيّرتَ الجرعة؟ اكتب نسخةً بتاريخ التغيير — وتُغلَق السابقةُ في اليوم الذي قبله، فتبقى تقاريرُ ما مضى محسوبةً بما كان عاملاً فيها."
        footer={
          <>
            {message && <p role={failed ? "alert" : "status"} className={`me-auto self-center text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</p>}
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("quiet")}>أغلِق</button>
            <button type="button" onClick={save} disabled={busy || !ready} className={buttonClass("primary")}>
              {busy ? "يُحفظ…" : "احفظ النسخة وفعِّلها"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="block text-[11px] font-medium text-muted">الصنف المباع</span>
            <select
              value={menuProductId}
              onChange={(e) => setMenuProductId(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
            >
              <option value="">اختر صنفاً…</option>
              {menuProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-muted">تسري من</span>
            <input
              type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
              className="nums mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm"
            />
          </label>
        </div>

        <p className="mt-5 text-[13px] font-bold">المكوّنات</p>
        <ul className="mt-2 space-y-2">
          {lines.map((line, at) => (
            <li key={at} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-line-soft bg-sunken/50 p-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_auto]">
              <label className="col-span-2 min-w-0 sm:col-span-1">
                <span className="block text-[11px] font-medium text-muted">المكوّن</span>
                <select
                  value={line.productId}
                  onChange={(e) => setLine(at, { productId: e.target.value })}
                  className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-sm"
                >
                  <option value="">اختر…</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>{i.name} ({i.unitLabel})</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="block text-[11px] font-medium text-muted">الكمّيّة</span>
                <input
                  type="text" inputMode="decimal" dir="ltr"
                  value={line.quantity}
                  onChange={(e) => setLine(at, { quantity: e.target.value })}
                  className="nums mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-center text-base"
                />
              </label>
              <label>
                <span className="block text-[11px] font-medium text-muted">الوحدة</span>
                <select
                  value={line.unit}
                  onChange={(e) => setLine(at, { unit: e.target.value })}
                  className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-sm"
                >
                  {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-[11px] font-medium text-muted">فاقدُ التجهيز ٪</span>
                <input
                  type="text" inputMode="decimal" dir="ltr"
                  value={line.prepLossPercent}
                  onChange={(e) => setLine(at, { prepLossPercent: e.target.value })}
                  placeholder="—"
                  className="nums mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-2 text-center text-base"
                />
              </label>
              {lines.length > 1 ? (
                <button
                  type="button"
                  aria-label="احذف هذا المكوّن"
                  onClick={() => setLines((ls) => ls.filter((_, i) => i !== at))}
                  className={`${buttonClass("quiet", "sm")} justify-self-end`}
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              ) : <span className="hidden sm:block" />}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "", unit: "G", prepLossPercent: "" }])}
          className={`${buttonClass("subtle", "sm")} mt-3`}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          أضِف مكوّناً
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          «فاقدُ التجهيز» نسبةُ ما يُصرَف من الرفّ ولا يصل الكوب — يُترَك فارغاً إن لم يُقَس، ولا يُفترَض صفراً
          في الحساب إلّا بمعنى «لم يُقَس».
        </p>
      </Sheet>
    </>
  );
}
