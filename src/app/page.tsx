import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Card, LinkButton, Section, StatGrid } from "@/components/ui";
import { AttentionList } from "@/components/attention-list";
import { buildAttention, countBySeverity } from "@/lib/attention";
import { gatherAttentionFacts } from "@/lib/attention-facts";
import { buildDataHealth } from "@/lib/data-health";
import { gatherHealthFacts } from "@/lib/data-health-facts";
import { spendByMonth } from "@/lib/analytics";
import { Figure } from "@/components/figure";
import { gatherHomeProvenance } from "@/lib/provenance-facts";

export const dynamic = "force-dynamic";

/**
 * الصفحة الرئيسية: حال المقهى، لا شاشة رفع.
 *
 * كانت `/` هي المُرفِع — وهو منطقي في «نظام فواتير»، لا في نظام يُفتح كل
 * صباح. فصار أوّل ما يُرى: ماذا يحتاج انتباهك، وأين المال، وما مدى اكتمال
 * ما بُنيت عليه هذه الأرقام. والرفع زرٌّ ظاهر لا صفحة أولى.
 */

function Bar({ label, value, max, note }: { label: string; value: number; max: number; note?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-xs font-medium">{label}</span>
        <span className="nums shrink-0 text-xs font-bold"><Money minor={value} /></span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-sunken">
        <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${pct}%` }} />
      </div>
      {note && <p className="mt-1 text-[10px] text-muted">{note}</p>}
    </div>
  );
}

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const showAmounts = can(user.role, "amounts:view");

  // مدير المشتريات لا يرى المال — تُعرض له وجهته مباشرةً
  if (!showAmounts) redirect("/upload");

  const [health, attentionFacts, prov] = await Promise.all([
    gatherHealthFacts().then(buildDataHealth),
    gatherAttentionFacts(),
    gatherHomeProvenance(),
  ]);

  const attention = buildAttention(attentionFacts);
  const counts = countBySeverity(attention);

  const invoiceRows = await db
    .select({
      periodMonth: invoices.periodMonth,
      totalMinor: invoices.totalMinor,
      supplierName: suppliers.nameAr,
      allocated: sql<number>`coalesce((
        select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
      ), 0)`,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id));

  const monthly = spendByMonth(invoiceRows);
  const thisMonth = monthly[monthly.length - 1];
  const prevMonth = monthly[monthly.length - 2];
  const trend =
    thisMonth && prevMonth && prevMonth.totalMinor > 0
      ? (thisMonth.totalMinor - prevMonth.totalMinor) / prevMonth.totalMinor
      : null;

  const bySupplier = new Map<string, number>();
  for (const r of invoiceRows) {
    const name = r.supplierName ?? "غير محدَّد";
    bySupplier.set(name, (bySupplier.get(name) ?? 0) + r.totalMinor);
  }
  const topSuppliers = [...bySupplier.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSupplier = topSuppliers[0]?.[1] ?? 0;
  const maxMonth = Math.max(...monthly.map((m) => m.totalMinor), 1);

  return (
    <PageShell
      user={user}
      width="wide"
     
      title="حال المقهى"
      intro="ما تحتاج معرفته أو فعله اليوم — لا ما في قاعدة البيانات من سجلات."
    >
      {/* ── الأرقام ── */}
      <StatGrid>
        {/*
          المبيعات وهامش الربح يحتاجان مصدر مبيعات لم يُوصَل بعد.
          صفرٌ هنا يوحي بأنّ المقهى لم يبع شيئاً — والفراغ الصادق خير منه.
        */}
        <Figure label="مبيعات اليوم" value="غير موصولة" tone="muted" note="لا مصدر مبيعات بعد" />

        <Figure
          label={`مشتريات ${prov.month ?? "الشهر"}`}
          provenance={prov.purchases}
          href="/purchases"
          tone={trend !== null && trend > 0.15 ? "warn" : undefined}
          note={
            trend === null
              ? undefined
              : `${trend > 0 ? "▲" : "▼"} ${Math.abs(Math.round(trend * 100))}٪ عن ${prevMonth!.month}`
          }
        />

        <Figure
          label="الرصيد المستحق"
          provenance={prov.outstanding}
          href="/money"
          tone={prov.outstanding.valueMinor > 0 ? "warn" : "ok"}
          note="للمورّدين الآن"
        />

        <Figure
          label="ضريبة مدخلات مؤكَّدة"
          provenance={prov.vat}
          href="/attention"
          note="من فواتير مستوفية الأركان وحدها"
        />
      </StatGrid>

      {/* ── ما يحتاج انتباهك ── */}
      <Section
        title={
          attention.length === 0
            ? "لا شيء يحتاج انتباهك"
            : `يحتاج انتباهك (${attention.length})`
        }
        action={
          attention.length > 0 ? (
            <Link href="/attention" className="text-xs font-medium underline underline-offset-4 hover:text-ink">
              {counts.CRITICAL} حرج · {counts.HIGH} عالٍ ←
            </Link>
          ) : undefined
        }
      >
        <AttentionList items={attention} limit={3} />
      </Section>

      {/* ── الاتجاه ── */}
      <div className="mt-8 grid gap-6 sm:mt-10 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-display text-lg font-bold leading-tight">المصروف الشهري</h2>
          <Card>
            <div className="space-y-3.5">
            {monthly.length === 0 ? (
              <p className="text-xs text-muted">لا بيانات بعد.</p>
            ) : (
              monthly.map((m) => (
                <Bar key={m.month} label={m.month} value={m.totalMinor} max={maxMonth} note={`${m.invoiceCount} فاتورة`} />
              ))
            )}
            </div>
          </Card>
        </section>

        <section>
          <h2 className="mb-3 font-display text-lg font-bold leading-tight">أعلى المورّدين</h2>
          <Card>
            <div className="space-y-3.5">
            {topSuppliers.length === 0 ? (
              <p className="text-xs text-muted">لا بيانات بعد.</p>
            ) : (
              topSuppliers.map(([name, total]) => (
                <Bar key={name} label={name} value={total} max={maxSupplier} />
              ))
            )}
            </div>
          </Card>
        </section>
      </div>

      {/* ── صحّة البيانات ── */}
      <Section
        title="صحّة البيانات"
        hint="الرقم بلا بيان تغطيته يخدع. هذه نسبة ما بُنيت عليه أرقام الصفحة — وما لم يُوصَل يُقال عنه «غير موصول» ولا يُملأ بصفر."
        action={
          <span className="nums text-sm font-bold">
            ثقة الأرقام {Math.round(health.confidence * 100)}٪
          </span>
        }
      >
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
          {health.metrics.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{m.label}</span>
                <span className="block truncate text-[11px] text-muted">{m.detail}</span>
              </span>
              <span
                className={`nums shrink-0 text-sm font-bold ${
                  m.state === "GOOD" ? "text-ok"
                  : m.state === "NOT_CONNECTED" ? "text-muted"
                  : m.state === "MISSING" ? "text-danger" : "text-warn"
                }`}
              >
                {m.coverage === null ? "غير موصول" : `${Math.round(m.coverage * 100)}٪`}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <div className="mt-8 flex flex-wrap gap-2">
        <LinkButton href="/upload" variant="primary">أضف مستنداً</LinkButton>
        <LinkButton href="/documents">الأرشيف</LinkButton>
      </div>
    </PageShell>
  );
}
