"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { buttonClass } from "./ui";
import type { StepRow } from "./inventory-count-steps";

/**
 * الأرصدةُ الافتتاحيّة دفعةً واحدة — لأوّل جرد، أو حين يبدأ المقهى.
 *
 * جدولٌ لا نموذجٌ محاسبيّ: الصنفُ وخانتُه ووحدتُه، وEnter ينقل إلى
 * التالي. **والفراغُ يبقى «غير معروف»** — لا يُرسَل، ولا يُكتَب صفراً.
 * ويُحفَظ ما كُتب وحده في طلبٍ واحد، والتحويلُ في الخادم.
 */
export function OpeningGrid({
  countId,
  rows,
  categories,
  onDone,
}: {
  countId: string;
  rows: StepRow[];
  categories: { key: string; label: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.productId, r.unitChoices[r.unitChoices.length - 1]?.value ?? r.baseUnit])),
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyUnknown, setOnlyUnknown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyUnknown && r.openingText !== null) return false;
      if (category && r.category !== category) return false;
      return q === "" || r.productName.toLowerCase().includes(q);
    });
  }, [rows, query, category, onlyUnknown]);

  const filled = rows.filter((r) => (values[r.productId] ?? "").trim() !== "");

  async function save() {
    if (filled.length === 0) return;
    setBusy(true);
    setError(null);
    const r = await postJson("/api/inventory/count", {
      action: "opening",
      countId,
      entries: filled.map((row) => ({
        productId: row.productId,
        quantity: values[row.productId].trim(),
        unit: units[row.productId] ?? row.baseUnit,
      })),
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setValues({});
    router.refresh();
    onDone();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>, at: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const inputs = document.querySelectorAll<HTMLInputElement>("[data-opening-input]");
    inputs[at + 1]?.focus();
  }

  return (
    <div className="mb-5 animate-rise rounded-2xl border border-accent-line bg-raised p-4 shadow-lifted sm:p-5">
      <p className="text-[14px] font-bold">الأرصدة الافتتاحيّة — ما كان على الرفّ أوّلَ الأسبوع</p>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        اكتب ما تعرفه، واترك ما لا تعرفه فارغاً — يبقى «غير معروف» ولا يُحسَب صفراً.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث…" aria-label="ابحث عن صنف"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-input bg-raised px-3 text-sm"
        />
        <select
          value={category} onChange={(e) => setCategory(e.target.value)} aria-label="رشِّح بالباب"
          className="min-h-11 rounded-lg border border-line-input bg-raised px-3 text-xs"
        >
          <option value="">كلّ الأبواب</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line-input bg-raised px-3 text-xs sm:min-h-9">
          <input type="checkbox" checked={onlyUnknown} onChange={(e) => setOnlyUnknown(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          غيرُ المعروف وحده
        </label>
      </div>

      <ul className="mt-3 divide-y divide-line-soft">
        {visible.map((row, at) => (
          <li key={row.productId} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {row.productName}
              {row.openingText !== null && (
                <span className="text-muted"> — الحاليّ {row.openingText} {row.openingSourceLabel}</span>
              )}
            </span>
            <input
              data-opening-input type="text" inputMode="decimal" dir="ltr"
              value={values[row.productId] ?? ""} placeholder="—" disabled={busy}
              aria-label={`الرصيد الافتتاحيّ لـ${row.productName}`}
              onChange={(e) => setValues((v) => ({ ...v, [row.productId]: e.target.value }))}
              onKeyDown={(e) => onKey(e, at)}
              className="nums h-12 w-28 rounded-lg border border-line-input bg-raised px-2 text-center text-base font-bold"
            />
            {row.unitChoices.length > 1 ? (
              <select
                value={units[row.productId]} disabled={busy}
                aria-label={`وحدةُ ${row.productName}`}
                onChange={(e) => setUnits((u) => ({ ...u, [row.productId]: e.target.value }))}
                className="h-12 w-20 rounded-lg border border-line-input bg-raised px-1 text-sm"
              >
                {row.unitChoices.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            ) : (
              <span className="w-16 text-[11px] text-muted">{row.unitLabel}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button aria-busy={busy} type="button" disabled={busy || filled.length === 0} onClick={() => void save()} className={buttonClass("primary")}>
          {filled.length === 0 ? "لا رصيدَ مكتوب" : `احفظ ${filled.length} رصيداً`}
        </button>
        <button type="button" disabled={busy} onClick={onDone} className={buttonClass("quiet", "sm")}>أغلِق</button>
        {error && <span role="alert" className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
