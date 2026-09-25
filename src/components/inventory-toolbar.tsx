"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";

/**
 * شريطُ البحث والترشيح بالباب — واحدٌ لخطوات الجرد كلّها، فلا يختلف
 * الحقلُ بين خطوةٍ وأخرى في مقاسه ولا في اسمه.
 */

export function Toolbar({
  query, setQuery, category, setCategory, categories, children,
}: {
  query: string;
  setQuery: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  categories: { key: string; label: string }[];
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <label className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
        <span className="sr-only">ابحث عن صنف</span>
        <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
          placeholder="ابحث عن صنف…"
          className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-9 pe-3 text-sm sm:min-h-9"
        />
      </label>
      {categories.length > 1 && (
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="رشِّح بالباب"
          className="min-h-11 rounded-lg border border-line-input bg-raised px-3 text-xs sm:min-h-9"
        >
          <option value="">كلّ الأبواب</option>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      )}
      {children}
    </div>
  );
}
