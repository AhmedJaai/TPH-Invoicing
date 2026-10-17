import { Sparkles } from "lucide-react";
import { PostAction } from "./post-action";
import { Badge } from "./ui";
import { SECTION_LABEL, type Fact, type ReadingSection } from "@/lib/finance/reading";
import { formatMoment } from "@/lib/riyadh-time";
import type { StoredReading } from "@/services/finance-reading.service";

const ORDER: readonly ReadingSection[] = ["CHANGED", "WHY", "DO"];

function factText(f: Fact): string {
  if (f.kind === "NOTE") return `${f.label}: ${f.note ?? ""}`;
  if (f.value === null) return `${f.label}: غير معروف`;
  const n = f.value.toLocaleString("en-US");
  return `${f.label}: ${n}${f.kind === "SAR" ? " ريال" : f.kind === "PCT" ? "٪" : ""}`;
}

/**
 * القراءةُ الذكيّة — **قراءةٌ واقتراح لا حكم**. كلُّ جملةٍ تحتها الأرقامُ المحسوبة التي
 * قامت عليها؛ وما ذكر رقماً ليس منها أُسقط قبل أن يبلغ هنا. تُطلَب بزرّ وتُحفَظ.
 */
export function FinanceReading({ month, stored, canAsk }: { month: string; stored: StoredReading | null; canAsk: boolean }) {
  const factOf = new Map((stored?.facts ?? []).map((f) => [f.id, f]));
  return (
    <div className="rounded-2xl border border-line bg-raised p-4 shadow-raised sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
            قراءة ذكية للشهر
            <Badge tone="muted">اقتراح وليس حكماً</Badge>
          </p>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">
            النموذج لا يحسب بنفسه، بل يُعطى الأرقام المحسوبة ويكتب عنها. ويُتحقق من كل رقم في كل جملة، وتُحذف الجملة إذا ذكرت رقماً ليس من هذه الأرقام.
          </p>
        </div>
        {canAsk && (
          <span className="no-print flex shrink-0 flex-wrap items-center gap-2">
            <PostAction url="/api/finance/reading" body={{ month }} variant={stored && !stored.stale ? "quiet" : "primary"} done="تمت كتابة القراءة">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
              {stored ? "اقرأ من جديد" : "اقرأ هذا الشهر"}
            </PostAction>
          </span>
        )}
      </div>

      {!stored ? (
        <p className="mt-4 rounded-xl bg-sunken/60 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          لم تُكتب قراءة لهذا الشهر بعد. الأرقام أعلاه كاملة بدونها.
        </p>
      ) : (
        <>
          {stored.stale && (
            <p role="status" className="mt-4 rounded-xl border border-warn/30 bg-warn-bg px-4 py-2.5 text-xs font-bold text-warn">
              تغيّرت الأرقام منذ كتابة هذه القراءة، فهي مبنية على أرقام سابقة. اضغط «اقرأ من جديد».
            </p>
          )}
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
            {ORDER.map((section) => {
              const list = stored.reading.sentences.filter((s) => s.section === section);
              return (
                <section key={section} aria-label={SECTION_LABEL[section]}>
                  <h3 className="text-xs font-bold text-ink-soft">{SECTION_LABEL[section]}</h3>
                  {list.length === 0 ? (
                    <p className="mt-2 text-xs text-muted">لا توجد جمل هنا بعد التحقق.</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {list.map((s, i) => (
                        <li key={i} className="text-[13px] leading-relaxed">
                          {s.text}
                          {s.facts.length > 0 && (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[11px] font-medium text-muted hover:text-ink">من أي أرقام؟</summary>
                              <ul className="mt-1 space-y-0.5 border-s-2 border-line ps-2 text-[11px] text-ink-soft">
                                {s.facts.map((id) => {
                                  const f = factOf.get(id);
                                  return f ? <li key={id}>{factText(f)}</li> : null;
                                })}
                              </ul>
                            </details>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] text-muted">
            كُتبت في <bdi>{formatMoment(new Date(stored.createdAt))}</bdi>
            {stored.reading.dropped > 0 && <> · حُذفت {stored.reading.dropped} جملة لأنها ذكرت رقماً ليس من الأرقام المحسوبة</>}
          </p>
        </>
      )}
    </div>
  );
}
