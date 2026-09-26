import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "./ui";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";

/** قطعُ الحركة المشتركة — سجلُّ البنك وملفُّ الحركة يرسمانها بشكلٍ واحد. */
const CATEGORY_TONE: Partial<Record<TxCategory, "warn" | "info" | "accent" | "muted" | "ok">> = {
  UNKNOWN: "warn",
  SUPPLIER: "accent",
  POS_SETTLEMENT: "ok",
  POS_FEE: "muted",
  POS_VAT: "muted",
  BANK_FEE: "muted",
  BANK_VAT: "muted",
  PERSONAL: "info",
};

export function CategoryBadge({ category }: { category: TxCategory }) {
  return <Badge tone={CATEGORY_TONE[category]}>{CATEGORY_LABEL[category] ?? category}</Badge>;
}

/**
 * السهمُ مع كلمةٍ مخفيّة للقارئ — اللونُ لا يأتي وحده.
 *
 * و`relative` على الوعاء شرط: `sr-only` موضعُه مطلق، وبلا سلفٍ مموضَع يفلت
 * من وعاء الجدول المُمرَّر فيطيل الصفحةَ كلَّها بطول الجدول (قيس: ٨٤٥٢ بكسلاً
 * لصفحةٍ محتواها ألفان).
 */
export function DirectionIcon({ direction, large = false }: { direction: "DEBIT" | "CREDIT"; large?: boolean }) {
  const out = direction === "DEBIT";
  const Icon = out ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      title={out ? "صادر" : "وارد"}
      className={`relative grid shrink-0 place-items-center rounded-full ${large ? "h-10 w-10" : "mt-0.5 h-7 w-7"} ${out ? "bg-sunken text-ink-soft" : "bg-ok-bg text-ok"}`}
    >
      <Icon className={large ? "h-5 w-5" : "h-3.5 w-3.5"} strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{out ? "صادر" : "وارد"}</span>
    </span>
  );
}
