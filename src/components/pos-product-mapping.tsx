"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import { toast } from "./ui-client";
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
    toast({ tone: "ok", title: `رُبط «${row.name}»`, body: "ويُعرَف بمعرّفه في كلّ استيرادٍ بعده." });
    router.refresh();
  }

  if (rows.length === 0) return null;

  return (
    <div>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold" dir="auto">{row.name}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                <span className="nums">{row.soldUnits}</span> وحدة بِيعت · <Money minor={row.soldMinor} />
                {row.category && <> · {row.category}</>}
              </p>
            </div>

            {canEdit ? (
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <select
                  value={selected[row.id] ?? ""}
                  onChange={(e) => setSelected((s) => ({ ...s, [row.id]: e.target.value }))}
                  aria-label={`اربط «${row.name}» بصنف`}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-2 text-sm sm:min-h-9 sm:w-64 sm:flex-none"
                >
                  <option value="">أنشئ صنفاً باسمه</option>
                  {menuProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => map(row)}
                  disabled={busyId !== null}
                  className={buttonClass("primary", "sm")}
                >
                  {busyId === row.id ? "يُربَط…" : "اربطه"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
