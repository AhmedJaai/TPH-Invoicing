import Link from "next/link";
import { Money } from "@/components/money";
import { buttonClass } from "./ui";
import { SEVERITY_LABEL, type AttentionItem, type AttentionSeverity } from "@/lib/attention";

/**
 * صفُّ مهمّة — لا بطاقةُ تنبيه.
 *
 * ── لماذا وُلد هذا المكوّن ──
 *
 * كانت الرئيسية تعرض `AttentionCard`: عنوانٌ، وشدّةٌ وبابٌ، ومبلغٌ
 * بثلاثة أسطر، وشرحٌ، و«الخطوة التالية»، وتفصيلٌ يُفتَح، وزرّ. مقاسُها
 * **٢٤٩ بكسلاً**. فعلى شاشة ١٣٦٦×٧٦٨ — وهي أكثر ما يُفتَح به هذا
 * النظام — كان زرُّ البند الأوّل عند ٧٣٣، والثاني عند ٩٦٧ تحت الطيّ.
 * أي أنّ صاحب المقهى يفتح نظامه صباحاً فيرى **مهمّةً واحدةً من ثماني**.
 *
 * والبطاقةُ صحيحةٌ في موضعها — في `/attention` حيث يُقرأ البند كلُّه
 * ويُحسَم. أمّا الرئيسية فسؤالُها أقصر: **ما الذي ينتظرني، وبأيّ
 * ترتيب؟** فيكفيه سطران وزرّ.
 *
 * ── ما بقي وما سقط ──
 *
 * بقي: العنوان (ما هو)، والمبلغ (كم يساوي)، وسطرُ «لماذا يهمّ»، وفعلٌ
 * واحدٌ باسم أثره. وسقط: شارةُ الباب — وهي اسمُ وحدةٍ في النظام لا خبرٌ
 * عن المهمّة — وقائمةُ الأدلّة، فموضعُها التفصيل.
 *
 * والارتفاع صار ~٨٠ بكسلاً، فخمسُ مهمّاتٍ حيث كانت واحدة.
 */

const RAIL: Record<AttentionSeverity, string> = {
  CRITICAL: "bg-danger",
  HIGH: "bg-warn",
  MEDIUM: "bg-line-strong",
  OPPORTUNITY: "bg-ok",
};

const TEXT: Record<AttentionSeverity, string> = {
  CRITICAL: "text-danger",
  HIGH: "text-warn",
  MEDIUM: "text-muted",
  OPPORTUNITY: "text-ok",
};

export function TaskRow({ item }: { item: AttentionItem }) {
  const { amountMinor } = item.impact;

  return (
    <li className="relative flex items-center gap-4 overflow-hidden rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
      <span className={`absolute inset-y-0 start-0 w-1 ${RAIL[item.severity]}`} aria-hidden />

      {/* ما هو، ولماذا يهمّ */}
      <span className="min-w-0 flex-1 ps-1.5">
        <Link
          href={`/attention?item=${encodeURIComponent(item.id)}`}
          className="block truncate text-sm font-bold leading-snug hover:underline hover:underline-offset-4"
        >
          {item.title}
        </Link>
        <span className="mt-0.5 flex items-baseline gap-2">
          <span className={`shrink-0 text-[11px] font-bold ${TEXT[item.severity]}`}>
            {SEVERITY_LABEL[item.severity]}
          </span>
          <span className="min-w-0 truncate text-[11px] leading-relaxed text-muted">
            {item.detail}
          </span>
        </span>
      </span>

      {/* كم يساوي — وعمودٌ بعرضٍ ثابت كي تلتقي الفواصل بين الصفوف */}
      <span className="nums-col hidden w-28 shrink-0 text-sm font-bold sm:block">
        {amountMinor !== null && amountMinor > 0 ? <Money minor={amountMinor} /> : ""}
      </span>

      {/* فعلٌ واحد، باسم أثره */}
      <Link href={item.href} className={`${buttonClass("secondary", "sm")} shrink-0`}>
        {item.actionLabel ?? "افتح السجلّات"}
      </Link>
    </li>
  );
}

export function TaskList({ items }: { items: readonly AttentionItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <TaskRow key={i.id} item={i} />
      ))}
    </ul>
  );
}
