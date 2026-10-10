import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { CircleAlert, CircleCheck, Clock3, type LucideIcon } from "lucide-react";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { DOCUMENT, countNoun } from "@/lib/arabic";
import { formatMoment, todayInRiyadh } from "@/lib/riyadh-time";

/**
 * «ما رفعتَه اليوم» — لمن يرفع ولا يرى المال: هل وصل ما رفعتُه؟
 *
 * مديرُ المشتريات يصوّر الفاتورة والمندوبُ عند الباب، ثمّ لا يعرف أقُرئت أم
 * تنتظر المالك أم رُفضت إلّا إن سأل. فتُسرَد مرفوعاتُه اليوم (بتوقيت الرياض)
 * بحال كلٍّ منها — **بلا مبالغ**: الاسمُ والساعةُ والحال وحدها.
 */
const STATE: Record<string, { label: string; icon: LucideIcon; tone: string }> = {
  PENDING: { label: "يُقرأ", icon: Clock3, tone: "text-muted" },
  EXTRACTED: { label: "قُرئ — ينتظر المراجعة", icon: Clock3, tone: "text-warn" },
  NEEDS_REVIEW: { label: "ينتظر المالك", icon: Clock3, tone: "text-warn" },
  ARCHIVED: { label: "اعتُمد وأُرشف", icon: CircleCheck, tone: "text-ok" },
  REJECTED: { label: "رُفض — اسأل المالك عن السبب", icon: CircleAlert, tone: "text-danger" },
};

export async function MyUploads({ userId, canOpen }: {
  userId: string;
  /** أيملك فتحَ ملفّ المستند؟ — وإلّا فالصفُّ خبرٌ لا رابطٌ يُغلَق في وجهه. */
  canOpen: boolean;
}) {
  const today = todayInRiyadh();
  const rows = await db
    .select({ id: documents.id, fileName: documents.fileName, status: documents.status, at: documents.uploadedAt })
    .from(documents)
    .where(and(
      eq(documents.uploadedById, userId),
      sql`(${documents.uploadedAt} at time zone 'Asia/Riyadh')::date = ${today}::date`,
    ))
    .orderBy(desc(documents.uploadedAt))
    .limit(40);

  if (rows.length === 0) return null;
  const waiting = rows.filter((r) => r.status !== "ARCHIVED" && r.status !== "REJECTED").length;

  return (
    <section aria-labelledby="mine-title" className="mt-8">
      <h2 id="mine-title" className="text-sm font-bold">ما رفعتَه اليوم</h2>
      <p className="mt-0.5 text-xs text-muted">
        {countNoun(rows.length, DOCUMENT)}{waiting > 0 ? ` — ${waiting} لم يُعتمَد بعد` : " — كلُّها حُسمت"}
      </p>
      <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {rows.map((r) => {
          const s = STATE[r.status] ?? STATE.PENDING;
          const Icon = s.icon;
          return (
            <li key={r.id}>
              <Row href={canOpen ? `/documents/file/${r.id}` : null}>
                <Icon className={`h-4 w-4 shrink-0 ${s.tone}`} strokeWidth={2} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold" dir="auto">{r.fileName}</span>
                  <span className={`block text-[11px] ${s.tone}`}>{s.label}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted">{formatMoment(r.at)}</span>
              </Row>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Row({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = "flex min-h-12 items-center gap-3 px-4 py-2.5";
  return href
    ? <Link href={href} className={`${cls} transition-colors hover:bg-hover`}>{children}</Link>
    : <div className={cls}>{children}</div>;
}
