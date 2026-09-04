import Link from "next/link";
import { Money } from "@/components/page-shell";
import {
  AREA_LABEL, SEVERITY_LABEL,
  type AttentionItem, type AttentionSeverity,
} from "@/lib/attention";

const STYLE: Record<AttentionSeverity, { box: string; text: string }> = {
  CRITICAL: { box: "border-danger/40 bg-danger-bg", text: "text-danger" },
  HIGH: { box: "border-warn/40 bg-warn-bg", text: "text-warn" },
  MEDIUM: { box: "border-line bg-raised", text: "text-ink-soft" },
  OPPORTUNITY: { box: "border-ok/40 bg-ok-bg", text: "text-ok" },
};

/**
 * بطاقة استثناء واحد.
 * البند بلا خطوة تالية ومكان يُعالَج فيه ليس تنبيهاً بل شكوى — فالزرّ إلزامي.
 */
export function AttentionCard({ item }: { item: AttentionItem }) {
  const s = STYLE[item.severity];
  return (
    <article className={`rounded-xl border p-4 ${s.box}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold leading-snug">{item.title}</h3>
        <span className={`shrink-0 text-[10px] font-bold ${s.text}`}>
          {SEVERITY_LABEL[item.severity]} · {AREA_LABEL[item.area]}
        </span>
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{item.detail}</p>
      <p className="mt-2 text-xs leading-relaxed">
        <span className="font-bold">الخطوة التالية: </span>
        {item.action}
      </p>

      {item.evidence.length > 0 && (
        <details className="mt-2.5">
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

      <Link
        href={item.href}
        className="mt-3 inline-block rounded-lg bg-inverse-surface px-3.5 py-1.5 text-[11px] font-bold text-inverse-ink"
      >
        عالِجها ←
      </Link>
    </article>
  );
}

export function AttentionList({ items }: { items: readonly AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center">
        <p className="text-sm font-bold text-ok">لا شيء يحتاج انتباهك.</p>
        <p className="mt-1 text-xs text-muted">
          كل ما يعرفه النظام سليم. وما لا يعرفه معروض في صحّة البيانات.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <AttentionCard key={i.id} item={i} />
      ))}
    </div>
  );
}
