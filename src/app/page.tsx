import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { LinkButton, Section } from "@/components/ui";
import { TaskList } from "@/components/task-list";
import { prioritize } from "@/lib/attention";
import { attentionItems } from "@/lib/work";
import { Changes } from "@/components/changes";
import { buildChanges, notable } from "@/lib/changes";
import { gatherChangeFacts } from "@/lib/changes-facts";
import { DAY, SUPPLIER, countNoun } from "@/lib/arabic";
import { formatMonth } from "@/lib/riyadh-time";
import { loadBalanceTotals, loadOverdueBalances } from "@/services/supplier-balance.service";

export const dynamic = "force-dynamic";

/** كم مهمّةً تُعرَض قبل «افتح الطابور». خمسٌ تملأ شاشة ٧٦٨ ولا تتجاوزها. */
const SHOWN = 5;

/**
 * الرئيسية: سطحُ قرار.
 *
 * ── ما كُشف بالقياس ──
 *
 * كانت الصفحة: بطاقتا رقمٍ كبيرتان (٢١٨→٤٥١)، ثمّ «يحتاج قرارك» عند
 * ٤٩١، وكلُّ بندٍ فيها ٢٤٩ بكسلاً. وعلى **١٣٦٦×٧٦٨** — وهو أشيعُ مقاسِ
 * حاسوبٍ محمول — يقع زرُّ المهمّة الأولى عند ٧٣٣ ملاصقاً للحافّة،
 * والثانية عند ٩٦٧ والثالثة عند ١٢٠١ تحت الطيّ.
 *
 * أي أنّ صاحب المقهى يفتح نظامه صباحاً ليسأل «ما الذي ينتظرني؟» فيجيبه
 * النظام بمهمّةٍ واحدةٍ من ثماني، وبرقمين كبيرين فوقها لا فعلَ لهما.
 * **والعملُ الذي لا يُرى لا يُنجَز** — وهو درسٌ تكرّر في هذا النظام.
 *
 * ── الترتيب الجديد، وسببُه ──
 *
 *   ١. **شريطُ الحال** — سطرٌ واحد لا بطاقتان: كم عليك، وكم لك، وكم
 *      اشتريتَ هذا الشهر. ~٩٠ بكسلاً بدل ٢٣٣. وهو أوّل شيءٍ لأنّ
 *      «كم عليّ؟» أوّلُ أسئلة صاحب العمل — لكنّه **سطرُ خبرٍ لا لوحة**:
 *      من أراد التفصيل ضغط.
 *   ٢. **ما ينتظرك** — خمسُ مهمّاتٍ مختصرة، لكلٍّ فعلُها.
 *   ٣. **ما تغيّر** — ويُعلَن حين لا شيء، فالقسمُ الذي يختفي يُقرأ
 *      «لم يُفحَص» لا «لا جديد».
 *
 * وما خرج من هنا لم يُحذَف: هو في موضعه حيث يُفعَل به شيء.
 */

/** خبرٌ في شريط الحال — رقمٌ وتسميةٌ وسطرُ سياق، يفتح موضعه. */
function Fact({
  label,
  minor,
  sub,
  href,
  tone,
}: {
  label: string;
  minor: number;
  sub: string;
  href: string;
  tone?: "warn";
}) {
  return (
    <Link
      href={href}
      className="group block min-w-0 flex-1 rounded-xl px-3.5 py-3 transition-colors hover:bg-sunken/60"
    >
      <span className="block text-[11px] font-medium text-muted">{label}</span>
      <span
        className={`nums mt-1 block font-display text-2xl font-black leading-none group-hover:underline group-hover:underline-offset-4 ${
          tone === "warn" ? "text-warn" : ""
        }`}
      >
        <Money minor={minor} />
      </span>
      <span className="mt-1.5 block truncate text-[11px] leading-relaxed text-muted">{sub}</span>
    </Link>
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

  const { totals } = balances;
  const oldestDays = overdue.reduce((m, r) => Math.max(m, r.oldestDays), 0);

  const facts = await gatherChangeFacts(0, 0);
  /*
    «المشتريات» و«المستحقّ عليك» بندان في `buildChanges` — وهما الرقمان
    المعروضان في شريط الحال. فيُطرحان هنا: التكرار لا يُضيف خبراً.
  */
  const changes = notable(buildChanges(facts)).filter(
    (c) => c.id !== "outstanding" && c.id !== "purchases",
  );

  const { top } = prioritize(attention, SHOWN);

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
      {/* ── شريطُ الحال: خبرٌ في سطر، لا لوحةُ مؤشّرات ── */}
      <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-raised p-1 shadow-raised sm:flex-row sm:divide-x sm:divide-x-reverse sm:divide-y-0">
        <Fact
          label="عليك للمورّدين"
          minor={totals.owedMinor}
          tone={totals.owedMinor > 0 ? "warn" : undefined}
          href="/suppliers"
          sub={
            totals.owedMinor === 0
              ? "لا مستحقّ على المقهى الآن."
              : `${countNoun(totals.owedSuppliers, SUPPLIER)} · أقدم دَينٍ منذ ${countNoun(oldestDays, DAY)}`
          }
        />
        {/*
          نصفُ الجواب ليس جواباً: مالٌ دفعتَه ولم يُخصم من فاتورةٍ بعينها
          يجلس عند المورّد. وكان سطراً داخل البطاقة الأولى فيُقرأ تتمّةً
          لها؛ وهو رقمٌ آخر لجهةٍ أخرى من الحساب، فصار خبراً بنفسه.
        */}
        {totals.creditLeftMinor > 0 && (
          <Fact
            label="ولك عند المورّدين"
            minor={totals.creditLeftMinor}
            href="/suppliers"
            sub={`${countNoun(totals.creditSuppliers, SUPPLIER)} · دفعتَه ولم تصلك فاتورته`}
          />
        )}
        <Fact
          label={`مشتريات ${formatMonth(facts.thisMonthLabel)}`}
          minor={facts.purchasesThisMonth}
          href="/purchases/invoices"
          sub={
            pct === null
              ? "من الفواتير المسجّلة، لا من كشف البنك"
              : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}٪ عن ${
                  facts.daysElapsedInMonth === null
                    ? formatMonth(facts.prevMonthLabel)
                    : `أوّل ${countNoun(facts.daysElapsedInMonth, DAY)} من ${formatMonth(facts.prevMonthLabel)}`
                }`
          }
        />
      </div>

      {/* ── ما ينتظرك ── */}
      <Section
        title={attention.length === 0 ? "لا شيء ينتظر قرارك" : "ما ينتظر قرارك"}
        hint={
          attention.length === 0
            ? "لا مالٌ خرج مرّتين، ولا دفعةٌ بلا مستند، ولا مستندٌ ينتظر."
            : undefined
        }
        action={
          attention.length > SHOWN ? (
            <Link
              href="/attention"
              className="text-xs font-medium underline underline-offset-4 hover:text-ink"
            >
              افتح الطابور ({attention.length}) ←
            </Link>
          ) : undefined
        }
      >
        {attention.length > 0 ? (
          <TaskList items={top} />
        ) : (
          <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ok">
            كلُّ ما يعرفه النظام سليم.
          </p>
        )}
      </Section>

      {/* ── ما تحرّك ── */}
      <Section title="ما الذي تغيّر" hint="منذ الأسبوع الماضي — وما في شريط الحال ليس مكرَّراً هنا.">
        {changes.length > 0 ? (
          <Changes changes={changes} />
        ) : (
          /*
            القسمُ الذي يختفي حين لا جديد يُقرأ «لم يُفحَص». والفرق بين
            «لا جديد» و«لم نفحص» هو الفرق بين الطمأنينة والجهل.
          */
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
            لا تغيّر يستحقّ الذكر منذ الأسبوع الماضي.
          </p>
        )}
      </Section>

      {attention.length > SHOWN && (
        <p className="text-center text-xs text-muted">
          <LinkButton href="/attention" size="sm">
            افتح الطابور كاملاً ({attention.length})
          </LinkButton>
        </p>
      )}
    </PageShell>
  );
}
