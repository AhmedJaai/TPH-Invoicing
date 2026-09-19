import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money, Prose } from "@/components/money";
import { Card, LinkButton, Section } from "@/components/ui";
import { AttentionList } from "@/components/attention-list";
import { countBySeverity, impactByKind } from "@/lib/attention";
import { formatRiyalsDisplay } from "@/lib/money";
import { attentionItems } from "@/lib/work";
import { Changes } from "@/components/changes";
import { buildChanges, notable } from "@/lib/changes";
import { gatherChangeFacts } from "@/lib/changes-facts";
import { DAY, SUPPLIER, countNoun } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import { loadBalanceTotals, loadOverdueBalances } from "@/services/supplier-balance.service";

export const dynamic = "force-dynamic";

/**
 * الرئيسية: مركزُ قيادة، لا لوحةَ مؤشّرات.
 *
 * كانت أربعَ بطاقاتِ أرقام، ثمّ «ما الذي تغيّر»، ثمّ التنبيهات، ثمّ
 * مخطّطَ المصروف الشهريّ، ثمّ مخطّطَ أعلى المورّدين، ثمّ سبعةَ مقاييس
 * لـ«صحّة البيانات». ستّةُ أقسامٍ يملأها الرقم، وواحدٌ فيها فعل.
 *
 * وثلاثةُ أشياءَ حُذفت وأسبابُها:
 *
 *   • **المخطّطان.** لا فعلَ لهما، وأرقامُهما موجودةٌ حيث يُفعَل بها
 *     شيء — المصروف الشهريّ في «المال»، وأعلى المورّدين في
 *     «المورّدون». والمخطّط الذي لا يُغيّر قراراً زينةٌ تُطيل الصفحة.
 *
 *   • **«صحّة البيانات».** سبعُ نسبِ تغطيةٍ («٩٥٪ من الفواتير لها
 *     بنود») — وهي سؤالُ من بنى النظام لا سؤالُ من يديره. وما ينقص
 *     منها فعلاً يظهر بنداً في «يحتاج قرارك» ومعه فعلُه.
 *
 *   • **الرقمان المكرّران.** كان ١٠٬٥٠٢٫٤٩ معروضاً في بطاقةٍ أعلى
 *     الشاشة ثمّ في «ما الذي تغيّر» تحتها مباشرةً، وكذلك ١١٬١١٩٫٧٤.
 *     رقمٌ واحدٌ مرّتين في شاشةٍ واحدة يجعل القارئ يبحث عن الفرق
 *     بينهما — ولا فرق.
 *
 * فبقي ثلاثة: **كم عليّ** ثمّ **ما ينتظرني** ثمّ **ما تحرّك**.
 */

/** بطاقةُ الرقم الأوّل — أكبر ممّا عداها لأنّها جواب السؤال الأوّل. */
function Headline({
  label,
  minor,
  sub,
  aside,
  href,
  action,
  tone,
}: {
  label: string;
  minor: number;
  sub: string;
  aside?: React.ReactNode;
  href: string;
  action: string;
  tone?: "warn";
}) {
  return (
    <Card className="flex flex-col">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={`nums mt-2 font-display text-[2.4rem] font-black leading-none sm:text-[2.9rem] ${
          tone === "warn" ? "text-warn" : ""
        }`}
      >
        <Money minor={minor} />
      </p>
      <p className="mt-2.5 text-xs leading-relaxed text-muted"><Prose text={sub} /></p>
      {aside}
      <div className="mt-4 pt-1">
        <LinkButton href={href} size="sm">{action}</LinkButton>
      </div>
    </Card>
  );
}

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/");

  // مدير المشتريات لا يرى المال — تُعرض له وجهته مباشرةً
  if (!can(user.role, "amounts:view")) redirect("/upload");

  const [attention, balances, overdue] = await Promise.all([
    attentionItems(),
    loadBalanceTotals(),
    loadOverdueBalances(),
  ]);

  const counts = countBySeverity(attention);
  const { totals } = balances;
  const oldestDays = overdue.reduce((m, r) => Math.max(m, r.oldestDays), 0);

  const facts = await gatherChangeFacts(0, 0);
  /*
    «المشتريات» و«المستحقّ عليك» بندان في `buildChanges` — وهما الرقمان
    المعروضان أعلى الشاشة بترندهما. فيُطرحان هنا: التكرار لا يُضيف خبراً.
  */
  const changes = notable(buildChanges(facts)).filter(
    (c) => c.id !== "outstanding" && c.id !== "purchases",
  );

  /* «قد يُسترد» ريالٌ خرج ويمكن ردُّه — وهو أقوى ما يحرّك صاحب المقهى. */
  const recoverableMinor = impactByKind(attention).RECOVERABLE?.amountMinor ?? 0;
  const recoverable =
    recoverableMinor > 0 ? ` ومنها ${formatRiyalsDisplay(recoverableMinor)} ريالاً قد تُسترد.` : "";

  const pct = facts.purchasesPrevMonth > 0
    ? Math.round(((facts.purchasesThisMonth - facts.purchasesPrevMonth) / facts.purchasesPrevMonth) * 100)
    : null;

  return (
    <PageShell
      user={user}
      width="wide"
      title="حال المقهى"
      intro="ما تحتاج معرفته أو فعله اليوم."
    >
      {/* ── السؤال الأوّل: كم عليّ ولمن ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Headline
          label="عليك للمورّدين"
          minor={totals.owedMinor}
          tone={totals.owedMinor > 0 ? "warn" : undefined}
          sub={
            totals.owedMinor === 0
              ? "لا مستحقّ على المقهى الآن."
              : `${countNoun(totals.owedSuppliers, SUPPLIER)} · أقدم دَينٍ منذ ${countNoun(oldestDays, DAY)}` +
                (totals.offsetMinor > 0
                  ? ` · بعد خصم ${formatRiyalsDisplay(totals.offsetMinor)} دفعتَها ولم تُخصم من فاتورة`
                  : "")
          }
          aside={
            /*
              نصفُ الجواب ليس جواباً: مالٌ دفعتَه ولم يُخصم من فاتورةٍ
              بعينها يجلس عند المورّد، وإن لم يُذكر هنا ظنّ صاحبُ المقهى
              أنّ حسابه معهم هو هذا الرقم وحده.
            */
            totals.creditLeftMinor > 0 ? (
              <p className="mt-2.5 border-t border-line pt-2.5 text-xs leading-relaxed">
                <span className="text-muted">ولك عند </span>
                <span className="font-medium">{countNoun(totals.creditSuppliers, SUPPLIER)}</span>
                <span className="nums font-bold"> <Money minor={totals.creditLeftMinor} /></span>
                <span className="text-muted"> — مالٌ دفعتَه ولم تصلك فاتورته.</span>
              </p>
            ) : undefined
          }
          href="/suppliers"
          action="افتح حسابات المورّدين"
        />

        <Headline
          label={`مشتريات ${formatMonth(facts.thisMonthLabel)}`}
          minor={facts.purchasesThisMonth}
          sub={
            pct === null
              ? `أوّل مشتريات في ${formatMonth(facts.thisMonthLabel)}`
              : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}٪ عن ${
                  facts.daysElapsedInMonth === null
                    ? formatMonth(facts.prevMonthLabel)
                    : `أوّل ${countNoun(facts.daysElapsedInMonth, DAY)} من ${formatMonth(facts.prevMonthLabel)}`
                }`
          }
          aside={
            <p className="mt-2.5 border-t border-line pt-2.5 text-xs leading-relaxed text-muted">
              محسوبةٌ من الفواتير المسجّلة — لا من كشف البنك.
            </p>
          }
          href="/purchases/invoices"
          action="افتح الفواتير"
        />
      </div>

      {/* ── السؤال الثاني: ما ينتظرني ── */}
      <Section
        title={attention.length === 0 ? "لا شيء يحتاج قرارك" : `يحتاج قرارك (${attention.length})`}
        hint={
          attention.length === 0
            ? undefined
            : `${counts.CRITICAL} حرج · ${counts.HIGH} عالٍ · ${counts.MEDIUM} متوسّط.` + recoverable
        }
        action={
          attention.length > 3 ? (
            <Link
              href="/attention"
              className="text-xs font-medium underline underline-offset-4 hover:text-ink"
            >
              افتح الكلّ ({attention.length}) ←
            </Link>
          ) : undefined
        }
      >
        <AttentionList items={attention} limit={3} />
      </Section>

      {/* ── السؤال الثالث: ما تحرّك ── */}
      {changes.length > 0 && (
        <Section title="ما الذي تغيّر" hint="منذ الأسبوع الماضي — وما فوقه ليس مكرَّراً هنا.">
          <Changes changes={changes} />
        </Section>
      )}
    </PageShell>
  );
}
