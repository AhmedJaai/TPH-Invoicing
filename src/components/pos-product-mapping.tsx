"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { Money } from "./money";

/**
 * «منتجات تحتاج ربطاً» — ويُربَط الصنفُ **مرّةً واحدة**.
 *
 * والربطُ يقع على معرّف الصنف عند فودكس لا على اسمه، فلا يُسأل صاحبُ
 * المقهى عن الشيء نفسه كلَّ أسبوع. وذاك عطبٌ وقع في طابور مراجعة
 * البنك: ثلاثٌ وأربعون حركةً أكّدها بيده كانت تعود إليه كلَّ مرّة.
 */
export interface UnmappedRow {
  id: string;
  externalId: string;
  name: string;
  category: string | null;
  soldUnits: number;
  soldMinor: number;
}

export function PosProductMapping({
  rows,
  menuProducts,
  canEdit,
}: {
  rows: UnmappedRow[];
  menuProducts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function map(row: UnmappedRow) {
    const choice = selected[row.id] ?? "";
    setBusyId(row.id);
    setError(null);

    const r = await postJson("/api/inventory/mapping", {
      action: "map",
      posProductIds: [row.id],
      ...(choice ? { productId: choice } : { newProductName: row.name }),
    });

    setBusyId(null);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-sm text-muted">
        كلُّ ما بِيع مربوطٌ بصنفٍ عندنا.
      </p>
    );
  }

  return (
    <div>
      <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold">{row.name}</p>
              <p className="nums text-[11px] text-muted">
                {row.soldUnits} وحدة · <Money minor={row.soldMinor} />
                {row.category && <span className="font-sans"> · {row.category}</span>}
              </p>
            </div>

            {canEdit && (
              <>
                <select
                  value={selected[row.id] ?? ""}
                  onChange={(e) => setSelected((s) => ({ ...s, [row.id]: e.target.value }))}
                  aria-label={`اربط «${row.name}» بصنف`}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-canvas px-2 text-xs sm:max-w-64"
                >
                  <option value="">أنشئ صنفاً باسمه</option>
                  {menuProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => map(row)}
                  disabled={busyId === row.id}
                  className={buttonClass("secondary", "sm")}
                >
                  {busyId === row.id ? "…" : "اربطه"}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
