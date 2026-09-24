import Link from "next/link";
import { ArrowLeft, CircleAlert, Lightbulb, TriangleAlert, Info } from "lucide-react";
import { Money } from "@/components/money";
import { buttonClass } from "./ui";
import { IMPACT_LABEL, SEVERITY_LABEL, type AttentionItem, type AttentionSeverity } from "@/lib/attention";

/**
 * صفُّ مهمّة — سطران وفعلٌ واحد، لا بطاقةُ تنبيه.
 *
 * الرئيسيةُ تسأل «ما الذي ينتظرني، وبأيّ ترتيب؟» فيكفيها: رمزُ الشدّة،
 * وما هو، ولماذا يهمّ، وكم يساوي، وفعلٌ باسم أثره. والتفصيلُ كلُّه في
 * `/attention` حيث يُحسم البند. والصفوفُ تُتنقَّل بـJ/K.
 */

const SEVERITY: Record<AttentionSeverity, { icon: typeof CircleAlert; chip: string; text: string }> = {
  CRITICAL: { icon: CircleAlert, chip: "bg-danger-bg text-danger", text: "text-danger" },
  HIGH: { icon: TriangleAlert, chip: "bg-warn-bg text-warn", text: "text-warn" },
  MEDIUM: { icon: Info, chip: "bg-info-bg text-info", text: "text-info" },
  OPPORTUNITY: { icon: Lightbulb, chip: "bg-ok-bg text-ok", text: "text-ok" },
};

export function TaskRow({ item }: { item: AttentionItem }) {
  const { amountMinor, kind } = item.impact;
  const s = SEVERITY[item.severity];
  const Icon = s.icon;
  const detailHref = `/attention?item=${encodeURIComponent(item.id)}`;

  return (
    <li
      data-nav-item=""
      data-href={`/attention?item=${encodeURIComponent(item.id)}`}
      className="card-rows group relative flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-hover sm:px-5"
    >
      <Link href={detailHref} aria-label="افتح التفصيل" tabIndex={-1} className="absolute inset-0" />
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${s.chip}`} title={SEVERITY_LABEL[item.severity]}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        <span className="sr-only">{SEVERITY_LABEL[item.severity]}</span>
      </span>

      <span className="min-w-0 flex-1">
        <Link href={detailHref} className="block truncate text-[14px] font-bold leading-snug hover:text-accent">
          {item.title}
        </Link>
        <span className="mt-0.5 block truncate text-xs leading-relaxed text-muted">{item.detail}</span>
      </span>

      {amountMinor !== null && amountMinor > 0 && (
        <span className="hidden w-32 shrink-0 text-end sm:block">
          <span className="nums-col block text-[14px] font-bold"><Money minor={amountMinor} /></span>
          <span className="block text-[11px] text-muted">{IMPACT_LABEL[kind]}</span>
        </span>
      )}

      <Link href={item.href} className={`${buttonClass("secondary", "sm")} hidden sm:inline-flex`}>
        {item.actionLabel ?? "افتح السجلّات"}
      </Link>
      <ArrowLeft className="h-4 w-4 shrink-0 text-muted sm:hidden" strokeWidth={2} aria-hidden />
    </li>
  );
}

export function TaskList({ items }: { items: readonly AttentionItem[] }) {
  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      {items.map((i) => (
        <TaskRow key={i.id} item={i} />
      ))}
    </ul>
  );
}
