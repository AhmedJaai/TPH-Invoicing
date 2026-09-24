"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";

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
}: {
  menuProducts: { id: string; name: string }[];
  ingredients: IngredientOption[];
  defaultFrom: string;
}) {
  const router = useRouter();
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
    setMessage(String(r.data.message ?? "حُفظت."));
    setLines([{ productId: "", quantity: "", unit: "G", prepLossPercent: "" }]);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <h2 className="font-display text-base font-bold">وصفةٌ جديدة أو نسخةٌ جديدة</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        غيّرتَ الجرعة؟ اكتب نسخةً جديدة بتاريخ التغيير. وتُغلَق السابقةُ في اليوم الذي
        قبله — فتبقى تقاريرُ ما مضى محسوبةً بما كان عاملاً فيها.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] text-muted">الصنف المباع</span>
          <select
            value={menuProductId}
            onChange={(e) => setMenuProductId(e.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
          >
            <option value="">اختر صنفاً…</option>
            {menuProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[11px] text-muted">تسري من</span>
          <input
            type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
            className="nums mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm"
          />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {lines.map((line, at) => (
          <div key={at} className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="block text-[11px] text-muted">المكوّن</span>
              <select
                value={line.productId}
                onChange={(e) => setLine(at, { productId: e.target.value })}
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-2 text-xs"
              >
                <option value="">اختر…</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} ({i.unitLabel})</option>
                ))}
              </select>
            </label>
            <label className="w-24">
              <span className="block text-[11px] text-muted">الكمّيّة</span>
              <input
                type="text" inputMode="decimal" dir="ltr"
                value={line.quantity}
                onChange={(e) => setLine(at, { quantity: e.target.value })}
                className="nums mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-2 text-center text-sm"
              />
            </label>
            <label className="w-24">
              <span className="block text-[11px] text-muted">الوحدة</span>
              <select
                value={line.unit}
                onChange={(e) => setLine(at, { unit: e.target.value })}
                className="mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-2 text-xs"
              >
                {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </label>
            <label className="w-24">
              <span className="block text-[11px] text-muted">فاقدُ التجهيز ٪</span>
              <input
                type="text" inputMode="decimal" dir="ltr"
                value={line.prepLossPercent}
                onChange={(e) => setLine(at, { prepLossPercent: e.target.value })}
                placeholder="—"
                className="nums mt-1 min-h-11 w-full rounded-xl border border-line bg-canvas px-2 text-center text-sm"
              />
            </label>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, i) => i !== at))}
                className={buttonClass("quiet", "sm")}
              >
                احذف
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { productId: "", quantity: "", unit: "G", prepLossPercent: "" }])}
          className={buttonClass("secondary", "sm")}
        >
          أضِف مكوّناً
        </button>
        <button type="button" onClick={save} disabled={busy || !ready} className={buttonClass("primary", "sm")}>
          {busy ? "يُحفظ…" : "احفظ النسخة وفعِّلها"}
        </button>
        {message && <span className={`text-xs ${failed ? "text-danger" : "text-ok"}`}>{message}</span>}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        «فاقدُ التجهيز» نسبةُ ما يُصرَف من الرفّ ولا يصل الكوب — يُترَك فارغاً إن لم
        يُقَس، ولا يُفترَض صفراً في الحساب إلّا بمعنى «لم يُقَس».
      </p>
    </div>
  );
}
