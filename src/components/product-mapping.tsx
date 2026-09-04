"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { CATEGORY_LABEL, type MergeSuggestion, type ProductCategory } from "@/lib/products";

export interface SupplierProductView {
  id: string;
  supplierName: string;
  displayName: string;
  normalized: string;
  productId: string | null;
  productName: string | null;
  confirmed: boolean;
  orderCount: number;
  lastUnitPriceMinor: number;
  totalSpentMinor: number;
}

export interface ProductOption {
  id: string;
  nameAr: string;
}

const CATEGORIES: ProductCategory[] = [
  "COFFEE", "DAIRY", "BAKERY", "FOOD", "BEVERAGE",
  "PACKAGING", "CLEANING", "EQUIPMENT", "OTHER",
];

/**
 * ربط صنف مورّد بصنف معياري.
 *
 * الاقتراح يُعرض مع ما يُضعفه — لا يُخفى ليبدو أقوى. ودرس «العنب» مكتوب
 * في الصفحة نفسها كي لا يُعاد.
 */
function LinkRow({
  items,
  products,
  suggestion,
  onDone,
}: {
  items: SupplierProductView[];
  products: ProductOption[];
  suggestion?: MergeSuggestion;
  onDone: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [newName, setNewName] = useState(items[0]?.displayName ?? "");
  const [category, setCategory] = useState<ProductCategory>("OTHER");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const creating = productId === "";

  const save = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/product", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "link",
          supplierProductIds: items.map((i) => i.id),
          productId: productId || undefined,
          newProductName: creating ? newName.trim() : undefined,
          category: creating ? category : undefined,
        }),
      });
      const json = await res.json();
      setMessage(json.message ?? json.error);
      setError(!res.ok);
      if (res.ok) onDone();
    } catch (e) {
      setMessage((e as Error).message);
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-3 py-3">
      <div className="space-y-1">
        {items.map((i) => (
          <div key={i.id} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{i.displayName}</span>
              <span className="block text-[11px] text-muted">
                {i.supplierName} · طُلب {i.orderCount} مرة
              </span>
            </span>
            <span className="nums shrink-0 text-xs" dir="ltr">
              {formatRiyalsDisplay(i.lastUnitPriceMinor)}
            </span>
          </div>
        ))}
      </div>

      {suggestion && suggestion.caveats.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-lg bg-warn-bg px-3 py-2">
          {suggestion.caveats.map((c, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-warn">⚠ {c}</li>
          ))}
        </ul>
      )}

      {message ? (
        <p className={`mt-2 text-[11px] font-bold ${error ? "text-danger" : "text-ok"}`}>
          {error ? "" : "✓ "}{message}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="min-w-[9rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
          >
            <option value="">صنف معياري جديد…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.nameAr}</option>
            ))}
          </select>

          {creating && (
            <>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="اسم الصنف المعياري"
                dir="auto"
                className="min-w-[9rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ProductCategory)}
                className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
            </>
          )}

          <button
            onClick={() => void save()}
            disabled={busy || (creating && newName.trim().length < 2)}
            className="shrink-0 rounded-lg bg-inverse-surface px-3 py-1.5 text-[11px] font-bold text-inverse-ink disabled:opacity-30"
          >
            {busy ? "يحفظ…" : items.length > 1 ? `اربط ${items.length} معاً` : "اربط"}
          </button>
        </div>
      )}
    </li>
  );
}

export function ProductMapping({
  rows,
  products,
  suggestions,
}: {
  rows: SupplierProductView[];
  products: ProductOption[];
  suggestions: MergeSuggestion[];
}) {
  const router = useRouter();
  const [done, setDone] = useState<Set<string>>(new Set());

  const onDone = useCallback((ids: string[]) => {
    setDone((prev) => new Set([...prev, ...ids]));
    router.refresh();
  }, [router]);

  const byNormalized = useMemo(() => {
    const m = new Map<string, SupplierProductView[]>();
    for (const r of rows) {
      const list = m.get(r.normalized) ?? [];
      list.push(r);
      m.set(r.normalized, list);
    }
    return m;
  }, [rows]);

  const unmapped = rows.filter((r) => !r.productId && !done.has(r.id));
  const mapped = rows.filter((r) => r.productId);

  // المرشّحات أوّلاً: ربطها يحسم صنفين بضغطة
  const suggestionGroups = suggestions
    .map((s) => ({ s, items: (byNormalized.get(s.normalized) ?? []).filter((i) => !i.productId && !done.has(i.id)) }))
    .filter((g) => g.items.length > 1);

  const suggestedIds = new Set(suggestionGroups.flatMap((g) => g.items.map((i) => i.id)));
  const singles = unmapped.filter((r) => !suggestedIds.has(r.id));

  return (
    <div className="space-y-8">
      {suggestionGroups.length > 0 && (
        <section>
          <h2 className="text-base font-bold">مرشّحات للجمع</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            أصناف تحمل الاسم نفسه عند مورّدين. وتطابق الاسم لا يعني تطابق الصنف —
            «عنب» عند المحمصة الغربية كيلو بنّ، وعند لافا زجاجة كمبوتشا. فما يُضعف
            الاقتراح معروض معه.
          </p>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {suggestionGroups.map((g) => (
              <LinkRow
                key={g.s.normalized}
                items={g.items}
                products={products}
                suggestion={g.s}
                onDone={() => onDone(g.items.map((i) => i.id))}
              />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-base font-bold">أصناف بلا ربط ({singles.length})</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          كلٌّ منها صنف مورّد قائم بذاته. ربطه بصنف معياري هو ما يسمح لاحقاً بجمع
          ما اشتريتَه من مورّدين مختلفين تحت شيء واحد.
        </p>
        {singles.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-ok">
            كل الأصناف مربوطة.
          </p>
        ) : (
          <ul className="mt-3 max-h-[36rem] divide-y divide-line overflow-y-auto rounded-2xl border border-line bg-raised shadow-raised">
            {singles.slice(0, 60).map((r) => (
              <LinkRow key={r.id} items={[r]} products={products} onDone={() => onDone([r.id])} />
            ))}
          </ul>
        )}
        {singles.length > 60 && (
          <p className="mt-2 text-xs text-muted">
            يُعرض ستّون من {singles.length} — الأكثر إنفاقاً أوّلاً.
          </p>
        )}
      </section>

      {mapped.length > 0 && (
        <section>
          <h2 className="text-base font-bold">مربوطة ({mapped.length})</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {mapped.slice(0, 40).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.displayName}</span>
                  <span className="block text-[11px] text-muted">{r.supplierName}</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-ok">← {r.productName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
