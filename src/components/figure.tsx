"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronDown, Wrench } from "lucide-react";
import { Money } from "./money";
import { TONE_TEXT, type Tone, isNumeric } from "./ui";
import type { Provenance } from "@/lib/provenance";

/**
 * رقمٌ يشرح نفسه.
 *
 * تحت كلّ رقمٍ مهمّ سطرٌ يقول ممّ بُني، وزرٌّ «من أين جاء؟» يفتح تفصيله:
 * ما دخل، وما استُبعد ولماذا، وأين يُصلَح. والرقمُ نفسه رابطٌ إلى صفحته —
 * كي لا يقف صاحب العمل عند رقمٍ لا يستطيع أن يسأله.
 */
export function Figure({
  label,
  provenance,
  value,
  unit = "فاتورة",
  href,
  tone,
  note,
  icon,
  className = "",
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
  /** رمزٌ مرسوم (عنصر لا مكوّن) — المكوّنُ دالّةٌ لا تعبر من الخادم إلى المتصفّح. */
  icon?: React.ReactNode;
  /** كي تتساوى ارتفاعاتُ البطاقات حين تقف في صفٍّ واحد. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  const cls = tone ? TONE_TEXT[tone] : "";
  const shown = value ?? (provenance ? <Money minor={provenance.valueMinor} /> : "—");
  /* خطّ الأرقام للرقم وحده — «غير موصولة» تُكتب بخطّ الواجهة */
  const big = `${value === undefined || isNumeric(value) ? "nums " : ""}block text-[1.75rem] font-bold leading-none tracking-tight sm:text-[2rem] ${cls}`;

  return (
    <div className={`rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5 ${className}`}>
      <p className="flex items-center gap-2 text-xs font-bold text-muted">
        {icon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-sunken text-ink-soft [&>svg]:h-4 [&>svg]:w-4">
            {icon}
          </span>
        )}
        {label}
      </p>

      {href ? (
        <Link href={href} className={`mt-4 ${big} transition-colors hover:text-accent`}>{shown}</Link>
      ) : (
        <p className={`mt-4 ${big}`}>{shown}</p>
      )}

      {note && <div className="mt-3 text-xs leading-relaxed text-muted">{note}</div>}

      {provenance && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="-mx-1.5 mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1.5 text-xs font-bold text-ink-soft transition-colors hover:bg-hover hover:text-ink sm:min-h-7"
          >
            <Dot confidence={provenance.confidence} />
            {open ? "أخفِ المصدر" : "من أين جاء؟"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
          </button>

          {open && <Breakdown provenance={provenance} unit={unit} />}
        </>
      )}
    </div>
  );
}

function Dot({ confidence }: { confidence: Provenance["confidence"] }) {
  const cls = confidence === "HIGH" ? "bg-ok" : confidence === "MEDIUM" ? "bg-warn" : "bg-danger";
  const title = confidence === "HIGH" ? "تغطية شبه تامّة" : confidence === "MEDIUM" ? "نقصٌ محدود" : "نقصٌ مؤثّر";
  return (
    <span className="inline-flex items-center" title={title}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${cls}`} />
      <span className="sr-only">{title}</span>
    </span>
  );
}

function Breakdown({ provenance: p, unit }: { provenance: Provenance; unit: string }) {
  const fixes = p.contributions.filter((c) => !c.included && c.href);
  return (
    <div className="mt-2 animate-rise overflow-hidden rounded-xl border border-line bg-sunken/50">
      <ul className="divide-y divide-line-soft">
        {p.contributions.map((c) => (
          <li key={c.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[11px]">
            <span className="min-w-0">
              <span className={`flex items-center gap-1.5 ${c.included ? "font-bold text-ink" : "text-muted"}`}>
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.included ? "bg-ok" : "bg-warn"}`} />
                {c.label}
                <span className="sr-only">{c.included ? " — داخلٌ في الرقم" : " — خارج الرقم"}</span>
              </span>
              {c.reason && <span className="mt-0.5 block text-muted">{c.reason}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap text-muted">
              <span className="nums">{c.count}</span> {c.unit ?? unit}
              {c.amountMinor !== null && c.amountMinor !== 0 && <> · <Money minor={c.amountMinor} /></>}
              {c.amountMinor === null && " · مبلغ مجهول"}
            </span>
          </li>
        ))}
      </ul>

      <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-relaxed text-muted">
        {p.coverage === null
          ? "لا شيء بُني عليه هذا الرقم بعد."
          : `التغطية ${Math.round(p.coverage * 100)}٪ بالعدد. ` +
            (p.excludedCount === 0
              ? "لا شيء خارج الرقم."
              : p.excludedUnknownCount > 0
                ? `و${p.excludedUnknownCount} منها مبلغها مجهول، فلا يصحّ افتراضه صفراً.`
                : "المستبعَد معروف مبلغه ومذكور أعلاه.")}
      </p>

      {fixes.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-line-soft px-3 py-2">
          {fixes.map((c) => (
            <Link
              key={c.id}
              href={c.href!}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-accent-soft px-2.5 text-xs font-bold text-accent hover:brightness-95 sm:min-h-8"
            >
              <Wrench className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              أصلِح: {c.label}
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
