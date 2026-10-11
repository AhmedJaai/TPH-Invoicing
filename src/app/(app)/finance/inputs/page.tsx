import { redirect } from "next/navigation";
import { ArrowRight, HandCoins, Info } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { PostAction } from "@/components/post-action";
import { DeclarationForm, type SpreadCandidate } from "@/components/finance-declaration-form";
import { Badge, Callout, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { CATEGORY_LABEL, isTxCategory, type TxCategory } from "@/lib/bank/rules";
import { monthsBetween, spreadShare } from "@/lib/finance/pnl";
import { formatRiyalsDisplay } from "@/lib/money";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { loadDeclarations, loadSpreadCandidates } from "@/services/profit.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** ما يُقرّ به: مصروفاتُ تشغيلٍ قد تقع خارج الكشف أو تُدفَع دفعةً لأشهر. */
const CATEGORIES: readonly TxCategory[] = ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "OTHER"];
const KIND_LABEL = { SPREAD: "دفعةٌ موزَّعة", OFF_BOOK: "خارج الكشف — شهريّ", NONE: "لا يوجد" } as const;

/**
 * ما لا يراه الكشف — الإيجارُ الذي يغطّي أشهراً، والراتبُ النقديّ، وما يُدفَع من حسابٍ
 * شخصيّ. بدونه يبقى الشهرُ «ربحاً قبل كذا». إقرارٌ يُقرأ فوق الدفاتر، لا قيدٌ فيها.
 */
export default async function FinanceInputsPage({ searchParams }: { searchParams: Promise<{ month?: string; category?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/inputs");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="ما لا يراه الكشف"><NoAccess what="إقرارات المالك" /></PageShell>;
  }
  const q = await searchParams;
  const month = q.month && MONTH_RE.test(q.month) ? q.month : currentMonthRiyadh();
  const category: TxCategory = q.category && isTxCategory(q.category) && CATEGORIES.includes(q.category) ? q.category : "RENT";
  const canEdit = can(user.role, "month:close");

  const [declarations, ...lists] = await Promise.all([loadDeclarations(), ...CATEGORIES.map((c) => loadSpreadCandidates(c))]);
  const candidates: Record<string, SpreadCandidate[]> = {};
  CATEGORIES.forEach((c, i) => {
    candidates[c] = lists[i].map((t) => ({ id: t.id, day: t.day, dayLabel: formatDay(t.day), amountText: formatRiyalsDisplay(t.amountMinor), label: t.label, spread: t.spread }));
  });
  /* إيجارٌ في الكشف لم يُقَل كم شهراً يغطّي — أوّلُ ما يُسأل عنه */
  const lumps = lists[CATEGORIES.indexOf("RENT")].filter((t) => !t.spread);
  const sorted = [...declarations].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <PageShell
      user={user}
      title="ما لا يراه الكشف"
      intro="الإيجارُ الذي دُفع مرّةً لأشهر، والراتبُ الذي يُدفَع نقداً، وما يخرج من حسابٍ شخصيّ. قُله مرّةً فيكتمل ربحُ الشهر."
      actions={<LinkButton href={`/finance?month=${month}`} variant="quiet" size="sm" icon={ArrowRight}>قائمةُ الدخل</LinkButton>}
    >
      {lumps.length > 0 && (
        <Callout tone="warn" icon={Info} title="إيجارٌ في الكشف لم يُقَل كم شهراً يغطّي">
          <ul className="space-y-1">
            {lumps.map((t) => (
              <li key={t.id}><bdi>{formatDay(t.day)}</bdi> — <strong><Money minor={t.amountMinor} currency /></strong> · {t.label}</li>
            ))}
          </ul>
          <p className="mt-2">شهرُ الدفع يحمله كلَّه اليوم، والأشهرُ حوله «ربحٌ قبل الإيجار». اختر «دفعةٌ في الكشف تغطّي أشهراً» أدناه وحدّد أشهرَها.</p>
        </Callout>
      )}

      {canEdit ? (
        <div className="mt-5">
          <DeclarationForm
            categories={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
            candidates={candidates}
            defaults={{ category, month, kind: category === "RENT" && lumps.length > 0 ? "SPREAD" : "OFF_BOOK" }}
          />
        </div>
      ) : (
        <Callout tone="info" icon={Info} className="mt-5" title="للقراءة فقط">الإقرارُ يكتبه من يملك إقفالَ الشهر.</Callout>
      )}

      <Section title="ما أقررتَه" icon={HandCoins} count={sorted.length} hint="كلُّ إقرارٍ يدخل قائمةَ الدخل في أشهره باسمه. سحبُه يعيد الشهرَ كما يقوله الكشف.">
        {sorted.length === 0 ? (
          <EmptyState icon={HandCoins} title="لم تُقرّ بشيءٍ بعد." hint="بلا إيجارٍ ولا رواتب يبقى الشهرُ «ربحاً قبل الإيجار» لا «صافي الربح»." />
        ) : (
          <ul className="space-y-2">
            {sorted.map((d) => {
              const months = monthsBetween(d.fromMonth, d.toMonth);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-raised">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      {d.label}
                      <Badge tone="accent">{KIND_LABEL[d.kind]}</Badge>
                      <Badge tone="muted">{CATEGORY_LABEL[d.category]}</Badge>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                      {d.fromMonth === d.toMonth ? formatMonth(d.fromMonth) : <>من {formatMonth(d.fromMonth)} إلى {formatMonth(d.toMonth)} ({months.length} أشهر)</>}
                      {d.kind === "SPREAD" && <> — <Money minor={d.amountMinor} /> تُوزَّع: <Money minor={spreadShare(d.amountMinor, d.fromMonth, d.toMonth, d.fromMonth)} /> للشهر</>}
                      {d.kind === "OFF_BOOK" && <> — <Money minor={d.amountMinor} /> لكلّ شهر</>}
                    </p>
                  </div>
                  {canEdit && (
                    <PostAction url="/api/finance/declaration" body={{ action: "void", id: d.id }} variant="quiet" done="سُحب الإقرار">اسحبه</PostAction>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
