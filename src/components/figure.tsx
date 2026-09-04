"use client";

import Link from "next/link";
import { useState } from "react";
import { Money } from "./money";
import { TONE_TEXT, type Tone } from "./ui";
import type { Provenance } from "@/lib/provenance";

/**
 * رقمٌ يشرح نفسه.
 *
 * تحت كل رقم مهمّ سطرٌ يقول ممّ بُني، وزرٌّ يفتح تفصيله: ما دخل، وما
 * استُبعد ولماذا، وأين يُصلَح. والرقم نفسه رابط إلى صفحته — كي لا يقف
 * صاحب العمل عند رقم لا يستطيع أن يسأله.
 */
export function Figure({
  label,
  provenance,
  value,
  unit = "فاتورة",
  href,
  tone,
  note,
}: {
  label: string;
  /** غياب البيان يعني رقماً لا مصدر له يُعرض — كحالة «غير موصول». */
  provenance?: Provenance;
  /** يُستعمل بدل المبلغ حين لا يكون الرقم مالاً. */
  value?: React.ReactNode;
  unit?: string;
  href?: string;
  tone?: Tone;
  note?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const cls = tone ? TONE_TEXT[tone] : "";
  const shown = value ?? (provenance ? <Money minor={provenance.valueMinor} /> : "—");
  const big = `nums font-display text-2xl font-bold leading-none sm:text-[1.75rem] ${cls}`;

  return (
    <div className="rounded-2xl border border-line bg-raised px-4 py-3.5 shadow-raised sm:px-5 sm:py-4">
      <p className="text-[11px] font-medium text-muted">{label}</p>

      {href ? (
        <Link href={href} className={`mt-2 block ${big} transition-opacity hover:opacity-70`}>
          {shown}
        </Link>
      ) : (
        <p className={`mt-2 ${big}`}>{shown}</p>
      )}

      {note && <p className="mt-2 text-[11px] leading-relaxed text-muted">{note}</p>}

      {provenance && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-2 flex items-center gap-1 text-[11px] text-muted underline decoration-dotted underline-offset-4 hover:text-ink-soft"
          >
            {open ? "أخفِ المصدر" : "من أين جاء؟"}
            <Dot confidence={provenance.confidence} />
          </button>

          {open && <Breakdown provenance={provenance} unit={unit} />}
        </>
      )}
    </div>
  );
}

function Dot({ confidence }: { confidence: Provenance["confidence"] }) {
  const cls =
    confidence === "HIGH" ? "bg-ok" : confidence === "MEDIUM" ? "bg-warn" : "bg-danger";
  const title =
    confidence === "HIGH" ? "تغطية شبه تامّة"
    : confidence === "MEDIUM" ? "نقصٌ محدود" : "نقصٌ مؤثّر";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${cls}`} title={title} aria-label={title} />;
}

function Breakdown({ provenance: p, unit }: { provenance: Provenance; unit: string }) {
  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <ul className="space-y-1.5">
        {p.contributions.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className="min-w-0">
              <span className={c.included ? "" : "text-muted line-through decoration-line"}>
                {c.label}
              </span>
              {c.reason && <span className="block text-[10px] text-muted">{c.reason}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted">
              <span className="nums">{c.count}</span> {c.unit ?? unit}
              {c.amountMinor !== null && c.amountMinor !== 0 && (
                <>
                  {" · "}
                  <Money minor={c.amountMinor} />
                </>
              )}
              {c.amountMinor === null && " · مبلغ مجهول"}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 text-[10px] leading-relaxed text-muted">
        {p.coverage === null
          ? "لا شيء بُني عليه هذا الرقم بعد."
          : `التغطية ${Math.round(p.coverage * 100)}٪ بالعدد. ` +
            (p.excludedCount === 0
              ? "لا شيء خارج الرقم."
              : p.excludedUnknownCount > 0
                ? `و${p.excludedUnknownCount} منها مبلغها مجهول، فلا يصحّ افتراضه صفراً.`
                : "المستبعَد معروف مبلغه ومذكور أعلاه.")}
      </p>

      {p.contributions.some((c) => !c.included && c.href) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {p.contributions
            .filter((c) => !c.included && c.href)
            .map((c) => (
              <Link
                key={c.id}
                href={c.href!}
                className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium hover:border-ink-soft"
              >
                أصلِح: {c.label}
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
