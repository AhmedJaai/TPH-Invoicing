"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { Money } from "./money";
import { ConfirmAction } from "./ui-client";
import { unitChoices } from "@/lib/inventory/units";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { isSinceBeginning } from "@/lib/inventory/recipe";
import { COST_REASON_LABEL } from "@/lib/inventory/recipe-cost";
import type { RecipeRow } from "@/services/recipe.service";

/**
 * الوصفاتُ صفوفاً تتمدّد في مكانها.
 *
 * ── ولماذا لا تُفتَح صفحة ──
 *
 * من يراجع وصفاته يمرّ عليها واحدةً بعد واحدة: يفتح، ينظر، يصحّح
 * رقماً، ويمضي. وصفحةٌ لكلّ وصفة تعني ذهاباً وإياباً ستّين مرّة،
 * ويفقد بينها موضعَه من القائمة. فالصفُّ يتمدّد، ويبقى ما حوله.
 *
 * ── التصحيحُ غيرُ التغيير ──
 *
 * **التصحيح** يقول «كانت دائماً كذا وأخطأنا في كتابتها» — فيسري على
 * الأسابيع كلِّها ولا يُنشئ نسخة. و**التغيير** يقول «من هنا صار كذا»
 * — فيُؤرَّخ، وتبقى تقاريرُ ما مضى محسوبةً بما كان.
 *
 * والفرقُ بينهما ليس تفضيلاً: من صحّح جرعةً كُتبت خطأً بنسخةٍ مؤرَّخة
 * ترك تقريرَ الأسبوع الماضي محسوباً بالخطأ الذي اكتشفه للتوّ.
 */
export interface IngredientChoice {
  id: string;
  name: string;
  baseUnit: StoredUnit;
}

export function RecipeRows({
  rows,
  choices,
  defaultChangeFrom,
}: {
  rows: readonly RecipeRow[];
  choices: readonly IngredientChoice[];
  defaultChangeFrom: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised">
      {rows.map((row) => (
        <li key={row.recipeId}>
          <button
            type="button"
            onClick={() => setOpen((o) => (o === row.recipeId ? null : row.recipeId))}
            aria-expanded={open === row.recipeId}
            className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-start hover:bg-canvas"
          >
            <span aria-hidden className="w-3 text-xs text-muted">
              {open === row.recipeId ? "▾" : "◂"}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{row.menuProductName}</span>

            <span className="nums text-[11px] text-muted">{row.ingredientCount} مكوّناً</span>

            <span className="nums-col w-24 text-xs">
              {row.costMinor === null
                ? <span className="text-[11px] text-muted">كلفةٌ غير معروفة</span>
                : <Money minor={row.costMinor} />}
            </span>
            <span className="nums-col w-20 text-xs text-muted">
              {row.priceMinor === null ? "—" : <Money minor={row.priceMinor} />}
            </span>
            <span className="nums-col w-20 text-xs font-bold">
              {row.costMinor === null || row.priceMinor === null
                ? "—"
                : <Money minor={row.priceMinor - row.costMinor} />}
            </span>
          </button>

          {open === row.recipeId && (
            <RecipePanel
              key={`${row.recipeId}:${row.activeVersion ?? 0}:${row.ingredientCount}`}
              row={row}
              choices={choices}
              defaultChangeFrom={defaultChangeFrom}
              onDeleted={() => setOpen(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

interface Draft {
  productId: string;
  name: string;
  quantity: string;
  unit: StoredUnit;
  baseUnit: StoredUnit;
  costMinor: number | null;
}

function RecipePanel({
  row, choices, defaultChangeFrom, onDeleted,
}: {
  row: RecipeRow;
  choices: readonly IngredientChoice[];
  defaultChangeFrom: string;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft[]>(
    row.ingredients.map((i) => ({
      productId: i.productId, name: i.name, quantity: i.quantity,
      unit: i.unit, baseUnit: i.baseUnit, costMinor: i.costMinor,
    })),
  );
  const [changeFrom, setChangeFrom] = useState(defaultChangeFrom);
  const [busy, setBusy] = useState<"correct" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const original = row.ingredients;
  const dirty = draft.length !== original.length
    || draft.some((d, i) => d.productId !== original[i]?.productId
      || d.quantity !== original[i]?.quantity
      || d.unit !== original[i]?.unit);

  const empty = draft.length === 0;

  async function submit(action: "correct" | "save") {
    setBusy(action);
    setError(null);
    setDone(null);

    const res = await postJson<{ message?: string }>("/api/inventory/recipe", {
      action,
      menuProductId: row.menuProductId,
      effectiveFrom: changeFrom,
      ingredients: draft.map((d) => ({ productId: d.productId, quantity: d.quantity, unit: d.unit })),
    });

    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    setDone(String(res.data.message ?? "حُفظ."));
    router.refresh();
  }

  const remaining = choices.filter((c) => !draft.some((d) => d.productId === c.id));

  return (
    <div className="border-t border-line bg-canvas px-3 py-3">
      <p className="text-[11px] leading-relaxed text-muted">
        {row.activeVersion === null
          ? "مسوّدة — لا تدخل الحساب حتّى تُفعَّل."
          : isSinceBeginning(row.activeFromLabel)
            ? `النسخة ${row.activeVersion} — سارية منذ البداية، فتغطّي الأسابيع كلَّها.`
            : `النسخة ${row.activeVersion} — سارية من ${row.activeFromLabel}.`}
        {row.versions > 1 && ` ولها ${row.versions} نسخ.`}
      </p>

      {empty ? (
        <p className="mt-3 text-xs text-warn">لا مكوّنَ في هذه النسخة.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {draft.map((line, at) => (
            <li key={line.productId} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">{line.name}</span>

              <label className="flex items-center gap-1.5">
                <span className="sr-only">{`كمّيّةُ ${line.name}`}</span>
                <input
                  type="text" inputMode="decimal" dir="ltr"
                  disabled={busy !== null}
                  value={line.quantity}
                  onChange={(e) => setDraft((v) => v.map((x, i) => (i === at ? { ...x, quantity: e.target.value } : x)))}
                  className="nums min-h-11 w-24 rounded-xl border border-line bg-raised px-2 text-center text-sm"
                />
              </label>

              <label>
                <span className="sr-only">{`وحدةُ ${line.name}`}</span>
                <select
                  disabled={busy !== null}
                  value={line.unit}
                  onChange={(e) => setDraft((v) => v.map((x, i) => (i === at ? { ...x, unit: e.target.value as StoredUnit } : x)))}
                  className="min-h-11 rounded-xl border border-line bg-raised px-2 text-xs"
                >
                  {unitChoices(line.baseUnit).map((u) => (
                    <option key={u} value={u}>{storedUnitLabel(u)}</option>
                  ))}
                </select>
              </label>

              <span className="nums-col w-20 text-[11px] text-muted">
                {line.costMinor === null ? "—" : <Money minor={line.costMinor} />}
              </span>

              <button
                type="button"
                aria-label={`احذف ${line.name} من الوصفة`}
                disabled={busy !== null}
                onClick={() => setDraft((v) => v.filter((_, i) => i !== at))}
                className={buttonClass("secondary", "sm")}
              >
                احذفه
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        ── ولِمَ يُسمّى السبب ──

        «لا كلفةَ معروفة» و«وحدةٌ لا تُحوَّل» عطبان يُصلَحان بفعلين
        مختلفين: الأوّلُ يُصلَح بمواصفة عبوةٍ للصنف، والثاني بتبديل
        وحدة السطر هنا. فمن قرأ «غير معروفة» وحدَها لا يعرف أيَّهما
        يفعل.
      */}
      {row.unknownCost.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-warn">
          {row.unknownCost.map((u) => (
            <li key={u.name}>{u.name}: {COST_REASON_LABEL[u.reason]}</li>
          ))}
        </ul>
      )}

      {remaining.length > 0 && (
        <label className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted">أضِف مكوّناً</span>
          <select
            value=""
            disabled={busy !== null}
            onChange={(e) => {
              const pick = choices.find((c) => c.id === e.target.value);
              if (!pick) return;
              setDraft((v) => [...v, {
                productId: pick.id, name: pick.name, quantity: "1",
                unit: pick.baseUnit, baseUnit: pick.baseUnit, costMinor: null,
              }]);
            }}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-raised px-3 text-sm"
          >
            <option value="">اختر صنفاً…</option>
            {remaining.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}

      {/*
        ── زرّان لا زرّ ──

        «صحِّحها» لمن أخطأ في كتابتها، و«احفظ تغييراً من…» لمن غيّر
        طريقته. وخلطُهما يجعل تقريرَ الأسبوع الماضي محسوباً بخطأٍ
        اكتُشف اليوم، أو يُعيد كتابة تاريخٍ لم يقع.
      */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {row.correctable ? (
          <button
            type="button"
            onClick={() => void submit("correct")}
            disabled={!dirty || empty || busy !== null}
            className={buttonClass("primary", "sm")}
          >
            {busy === "correct" ? "يُصحَّح…" : "صحِّحها — تسري على الأسابيع كلِّها"}
          </button>
        ) : (
          <p className="text-[11px] leading-relaxed text-warn">
            حُسب بهذه النسخة جردٌ مقفَل، فلا تُصحَّح في مكانها — غيِّرها بتاريخ.
          </p>
        )}

        <label className="flex flex-wrap items-end gap-2">
          <span className="text-[11px] text-muted">
            أو غيِّرها من
            <input
              type="date"
              value={changeFrom}
              disabled={busy !== null}
              onChange={(e) => setChangeFrom(e.target.value)}
              className="nums mt-1 block min-h-11 rounded-xl border border-line bg-raised px-2 text-sm"
            />
          </span>
          <button
            type="button"
            onClick={() => void submit("save")}
            disabled={!dirty || empty || busy !== null || changeFrom === ""}
            className={buttonClass("secondary", "sm")}
          >
            {busy === "save" ? "يُحفَظ…" : "احفظ تغييراً"}
          </button>
        </label>

        <ConfirmAction
          label="احذف الوصفة"
          title={`حذفُ وصفة «${row.menuProductName}»`}
          consequence={
            `تُحذَف نسخُها كلُّها (${row.versions})، فلا يُحسَب لهذا الصنف استهلاكٌ بعدها`
            + " — ويظهر ما اشتُري من مكوّناته كلُّه «فرقاً» في الجرد."
          }
          acknowledgement="أفهم أنّ استهلاك هذا الصنف لن يُحسَب بعد الحذف."
          confirmLabel="احذفها"
          tone="warn"
          variant="secondary"
          disabled={busy !== null}
          onConfirm={async () => {
            const res = await postJson("/api/inventory/recipe", {
              action: "delete", menuProductId: row.menuProductId,
            });
            if (!res.ok) { setError(res.error); return false; }
            onDeleted();
            router.refresh();
            return true;
          }}
        />
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-[11px] leading-relaxed text-danger">
          {error}
        </p>
      )}
      {done && <p className="mt-3 text-[11px] text-ok">{done}</p>}
    </div>
  );
}
