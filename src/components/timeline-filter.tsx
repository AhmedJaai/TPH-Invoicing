"use client";

import { useState } from "react";

/**
 * مرشِّحُ خطٍّ زمنيّ مرسومٍ في الخادم — يُخفي ما ليس من النوع المختار بلا طلبٍ جديد.
 * الأحداثُ تحمل `data-kind` (`Timeline`)، والإخفاءُ بسمةٍ على الوعاء (`globals.css`).
 * والمرشِّحُ الذي لا حدثَ له لا يُعرض: زرٌّ يفتح قائمةً فارغة طريقٌ مسدود.
 */
export function TimelineFilter({
  filters,
  children,
}: {
  filters: readonly { id: string; label: string; count: number }[];
  children: React.ReactNode;
}) {
  const [show, setShow] = useState("ALL");
  const visible = filters.filter((f) => f.id === "ALL" || f.count > 0);
  return (
    <div data-timeline-show={show}>
      {visible.length > 2 && (
        <div role="group" aria-label="تصفية الأحداث" className="mb-3 flex flex-wrap gap-1.5">
          {visible.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={show === f.id}
              onClick={() => setShow(f.id)}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors sm:min-h-8 ${
                show === f.id ? "border-transparent bg-inverse-surface text-inverse-ink" : "border-line bg-raised text-ink-soft hover:bg-hover"
              }`}
            >
              {f.label}
              <span className="nums nums-count text-[10px] opacity-70">{f.count}</span>
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
