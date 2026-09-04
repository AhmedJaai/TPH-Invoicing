"use client";

import Link from "next/link";
import { useState } from "react";
import { Money } from "@/components/money";
import { ITEM, countNoun } from "@/lib/arabic";
import {
  AREA_LABEL, IMPACT_LABEL, SEVERITY_LABEL, prioritize,
  type AttentionItem, type AttentionSeverity,
} from "@/lib/attention";

const STYLE: Record<AttentionSeverity, { box: string; text: string; rail: string }> = {
  CRITICAL: { box: "border-danger/40 bg-danger-bg", text: "text-danger", rail: "bg-danger" },
  HIGH: { box: "border-warn/40 bg-warn-bg", text: "text-warn", rail: "bg-warn" },
  MEDIUM: { box: "border-line bg-raised", text: "text-ink-soft", rail: "bg-line-strong" },
  OPPORTUNITY: { box: "border-ok/40 bg-ok-bg", text: "text-ok", rail: "bg-ok" },
};

/**
 * بطاقة استثناء واحد.
 * البند بلا خطوة تالية ومكان يُعالَج فيه ليس تنبيهاً بل شكوى — فالزرّ إلزامي.
 */
export function AttentionCard({ item }: { item: AttentionItem }) {
  const s = STYLE[item.severity];
  return (
    <article className={`relative overflow-hidden rounded-2xl border p-4 shadow-raised sm:p-5 ${s.box}`}>
      {/* شريطٌ جانبيّ يُعرِّف الشدّة قبل أن يُقرأ نصّها */}
      <span className={`absolute inset-y-0 start-0 w-1 ${s.rail}`} aria-hidden />

      <div className="flex items-start justify-between gap-3 ps-2">
        <h3 className="font-display text-base font-bold leading-snug">{item.title}</h3>
        <span className={`shrink-0 whitespace-nowrap text-[10px] font-bold ${s.text}`}>
          {SEVERITY_LABEL[item.severity]} · {AREA_LABEL[item.area]}
        </span>
      </div>

      <div className="ps-2">
        <Impact item={item} />
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">{item.detail}</p>
      </div>
      <p className="mt-2.5 ps-2 text-xs leading-relaxed">
        <span className="font-bold">الخطوة التالية: </span>
        {item.action}
      </p>

      {item.evidence.length > 0 && (
        <details className="mt-3 ps-2">
          <summary className="cursor-pointer list-none text-[11px] font-bold underline underline-offset-4 opacity-80 hover:opacity-100">
            اعرض التفاصيل ({item.evidence.length})
          </summary>
          <ul className="mt-2 divide-y divide-line/60 rounded-lg border border-line/60 bg-surface/60">
            {item.evidence.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium">{e.label}</span>
                  {e.sub && <span className="block truncate text-[10px] text-muted">{e.sub}</span>}
                </span>
                {e.amountMinor !== undefined && (
                  <span className="shrink-0 text-[11px] font-bold">
                    <Money minor={e.amountMinor} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 ps-2">
        <Link
          href={item.href}
          className="inline-flex items-center gap-1.5 rounded-xl bg-inverse-surface px-4 py-2 text-xs font-bold text-inverse-ink transition-opacity hover:opacity-90"
        >
          عالِجها ←
        </Link>
      </div>
    </article>
  );
}

/**
 * أثر البند بالريال، فوق شرحه.
 *
 * «ارتفع السعر ١٢٪» لا تُحرّك أحداً؛ «يكلّفك ٦٬٤٠٠ في السنة» تُحرّكه.
 * والنوع يُذكر معه كي لا يُخلط ما قد يُسترد بما هو مستحقّ عليك.
 */
function Impact({ item }: { item: AttentionItem }) {
  const { kind, amountMinor } = item.impact;
  if (amountMinor === null || amountMinor === 0) {
    return <p className="mt-2 text-[11px] font-bold opacity-70">{IMPACT_LABEL[kind]}</p>;
  }
  return (
    <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
      <span className="nums font-display text-xl font-bold leading-none">
        <Money minor={amountMinor} />
      </span>
      <span className="text-[11px] opacity-70">{IMPACT_LABEL[kind]}</span>
    </p>
  );
}

/**
 * أهمّ ثلاثة، والباقي مطويّ.
 *
 * أربعة عشر بنداً معروضة دفعةً واحدة ليست أولويّة بل قائمة — ومن يراها
 * كلّها لا يبدأ بشيء.
 */
export function AttentionList({
  items,
  limit = 3,
}: {
  items: readonly AttentionItem[];
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line px-5 py-12 text-center">
        <p className="text-sm font-bold text-ok">لا شيء يحتاج انتباهك.</p>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted">
          كل ما يعرفه النظام سليم. وما لا يعرفه معروض في صحّة البيانات.
        </p>
      </div>
    );
  }
  const { top, rest } = prioritize(items, limit);
  const shown = showAll ? [...top, ...rest] : top;

  return (
    <div className="space-y-2.5">
      {shown.map((i) => (
        <AttentionCard key={i.id} item={i} />
      ))}

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="w-full rounded-2xl border border-dashed border-line px-4 py-3.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink-soft hover:bg-sunken/50"
        >
          {showAll ? "اطوِ الباقي" : `بقي ${countNoun(rest.length, ITEM)} أقلّ أهمّية`}
        </button>
      )}
    </div>
  );
}
