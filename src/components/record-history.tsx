/**
 * «سجلّ القرار» على السجلّ نفسه — من فعل ماذا، ومتى، ولماذا.
 *
 * كان سجلُّ التدقيق صفحةً واحدة لكلّ ما في النظام، فمن فتح فاتورةً أو حركةَ بنكٍ لم يرَ مَن قيّدها ولا
 * مَن غيّر مبلغها ولا سببَه إلّا بالبحث بين مئات القيود. وصاحبُ المقهى يعتمد على النظام كلّيّاً
 * (أحمد، ٢٢ نوفمبر ٢٠٢٦: «فيه حفظ لكل قراراتي»): فكلُّ سجلٍّ ماليٍّ يحمل قراراتِه تحته.
 *
 * يقرأ `audit_logs` للسجلّ وما يتبعه (مستندُه، دفعاتُه)، والسجلُّ نفسُه لا يُعدَّل ولا يُحذف.
 */
import { and, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { Bot, History, UserRound } from "lucide-react";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { actionLabel, auditEntries } from "@/lib/audit-labels";
import { auditActorName, isSystemAudit } from "@/lib/audit-actor";
import { T } from "@/components/i18n/t";

const WHEN = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: "Asia/Riyadh", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** حقولُ السبب كما تكتبها الخدماتُ في `after` — تُرفع فوق التفاصيل: «لماذا» أوّلُ ما يُسأل. */
const REASON_KEYS = ["السبب", "سبب", "reason", "الملاحظة"];

/** ما قبل وما بعد — مقروءاً (`auditEntries`). و`compare` الطرفُ الآخر: يُعرض ما تغيّر وحده. يُستعمل هنا وفي «سجل التدقيق». */
export function AuditDetail({ value, label, compare }: { value: unknown; label: string; compare?: unknown }) {
  const entries = auditEntries(value, compare);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold text-muted">{label}</p>
      <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
        {entries.map((e) => (
          <div key={e.key} className="contents text-[11px]">
            <dt className="text-muted">{e.label}</dt>
            <dd className="min-w-0 break-words text-ink-soft" dir="auto">{e.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function reasonOf(after: unknown): string | null {
  if (typeof after !== "object" || after === null || Array.isArray(after)) return null;
  for (const k of REASON_KEYS) {
    const v = (after as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export async function RecordHistory({
  entities,
  viewerId,
  limit = 25,
}: {
  /** السجلُّ وما يتبعه — `invoice:<id>` · `document:<id>` · `payment:<id>`… */
  entities: readonly { type: string; id: string }[];
  viewerId?: string;
  limit?: number;
}) {
  const pairs = entities.filter((e) => e.id);
  if (pairs.length === 0) return null;
  const byType = new Map<string, string[]>();
  for (const e of pairs) byType.set(e.type, [...(byType.get(e.type) ?? []), e.id]);
  const conds: SQL[] = [...byType].map(([type, ids]) => and(eq(auditLogs.entityType, type), inArray(auditLogs.entityId, ids))!);

  const rows = await db
    .select({
      id: auditLogs.id, action: auditLogs.action, before: auditLogs.before, after: auditLogs.after, at: auditLogs.at,
      actorId: auditLogs.actorId, actorName: users.name, actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(or(...conds))
    .orderBy(desc(auditLogs.at))
    .limit(limit);

  return (
    <section aria-labelledby="record-history-title" className="mt-8">
      <h2 id="record-history-title" className="mb-3 flex items-center gap-2 text-[15px] font-bold">
        <History className="h-[18px] w-[18px] text-muted" strokeWidth={1.75} aria-hidden />
        سجلّ القرار
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-xs text-muted">
          لم يُسجَّل على هذا السجل قرار بعد. كل تعديل أو إقرار أو سداد عليه يُكتب هنا باسم من فعله ووقته وسببه.
        </p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const reason = reasonOf(r.after);
            const hasDetail = (r.after !== null && typeof r.after === "object") || (r.before !== null && typeof r.before === "object");
            return (
              <li key={r.id} className="rounded-xl border border-line bg-raised px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="text-[13px] font-bold">{actionLabel(r.action)}</p>
                  <p className="nums text-[11px] text-muted"><bdi>{WHEN.format(r.at)}</bdi></p>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  {isSystemAudit(r)
                    ? <Bot className="h-3 w-3" strokeWidth={2} aria-hidden />
                    : <UserRound className="h-3 w-3" strokeWidth={2} aria-hidden />}
                  {auditActorName({ ...r, actorName: r.actorName ?? r.actorEmail }, viewerId)}
                </p>
                {reason && (
                  <p className="mt-1.5 text-xs text-ink-soft" dir="auto">
                    <T s="السبب: {0}" a={[<span key="0" className="font-semibold text-ink">{reason}</span>]} />
                  </p>
                )}
                {hasDetail && (
                  <details className="mt-1.5">
                    <summary className="inline-flex min-h-11 cursor-pointer items-center text-[11px] font-bold text-ink-soft hover:text-accent sm:min-h-6">
                      التفاصيل
                    </summary>
                    <div className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-3 rounded-lg bg-sunken/60 p-3 sm:grid-cols-2">
                      <AuditDetail value={r.before} compare={r.after} label="قبل" />
                      <AuditDetail value={r.after} compare={r.before ?? undefined} label={r.before ? "بعد" : "ما سُجّل"} />
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
