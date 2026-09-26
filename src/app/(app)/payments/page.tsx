import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleCheck, PauseCircle, ShieldCheck } from "lucide-react";
import { invoiceHref } from "@/lib/invoice-profile";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Callout, EmptyState, LinkTabs, NoAccess, Section, Stat, StatGrid } from "@/components/ui";
import { PayRunPlanner, WhatsAppLink, type PlannerSupplier } from "@/components/pay-run-planner";
import { buildSupplierMessage } from "@/lib/payment-run";
import { previousMonth } from "@/lib/filing";
import { INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import { loadPayeeAccounts } from "@/services/payee-account.service";
import { loadPaymentRun } from "@/services/payment-run.service";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { db } from "@/db";
import { suppliers as suppliersTable } from "@/db/schema";
import { inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * دفعةُ الشهر — مخطِّطُ ما يُحوَّل.
 *
 * مستحقّاتُ الشهر المنقضي وما تأخّر قبله، مورّداً مورّداً: تختار من تدفع
 * له فيتغيّر المجموعُ والملفّ، وترى ما يبقى عليك لكلٍّ بعد التحويل، وتسجّل
 * السدادَ بتراجعٍ من الإشعار. وما ليس فاتورةً ضريبيةً كاملة يُحجز —
 * السدادُ قبل الحصول عليها يفقدك ورقة التفاوض الوحيدة.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/payments");
  if (!can(user.role, "payment:approve")) {
    return (
      <PageShell user={user} width="wide" title="دفعة الشهر">
        <NoAccess what="اعتماد الدفعات" />
      </PageShell>
    );
  }

  const { month: raw } = await searchParams;
  const current = currentMonthRiyadh();
  const defaultMonth = previousMonth(current);
  const month = /^\d{4}-\d{2}$/.test(raw ?? "") ? raw! : defaultMonth;

  const [run, balances] = await Promise.all([loadPaymentRun(month), loadSupplierBalances()]);
  const [accounts, slugs] = await Promise.all([
    loadPayeeAccounts(run.ready.map((r) => r.supplierId)),
    run.ready.length > 0
      ? db.select({ id: suppliersTable.id, slug: suppliersTable.slug }).from(suppliersTable).where(inArray(suppliersTable.id, run.ready.map((r) => r.supplierId)))
      : Promise.resolve([]),
  ]);
  const owedBy = new Map(balances.map((b) => [b.supplierId, b.owedMinor]));
  const slugBy = new Map(slugs.map((s) => [s.id, s.slug]));

  const planner: PlannerSupplier[] = run.ready.map((s) => {
    const acc = accounts.get(s.supplierId);
    return {
      supplierId: s.supplierId,
      name: s.supplierName,
      slug: slugBy.get(s.supplierId) ?? null,
      totalMinor: s.totalMinor,
      creditAppliedMinor: s.creditAppliedMinor,
      owedMinor: owedBy.get(s.supplierId) ?? null,
      account: acc?.account ?? null,
      accountNote: acc?.note ?? null,
      invoices: s.invoices.map((i) => ({
        id: i.invoiceId,
        number: i.invoiceNumber,
        date: formatDay(i.invoiceDate),
        openMinor: i.totalMinor - i.allocatedMinor,
        href: invoiceHref(i.invoiceId),
      })),
    };
  });

  const heldBySupplier = new Map<string, typeof run.held>();
  for (const h of run.held) {
    const list = heldBySupplier.get(h.invoice.supplierName) ?? [];
    list.push(h);
    heldBySupplier.set(h.invoice.supplierName, list);
  }

  const months = [previousMonth(defaultMonth), defaultMonth, current];
  const empty = run.ready.length === 0 && run.held.length === 0 && run.coveredByCredit.length === 0;

  return (
    <PageShell
      user={user}
      width="wide"
      title="دفعة الشهر"
      eyebrow={`مستحقّات ${formatMonth(month)} وما تأخّر قبلها`}
      intro="اختر من تحوِّل له هذه المرّة، وانظر ما يبقى عليك لكلٍّ بعدها، ثمّ نزّل ملفّ التحويلات أو سجّل السداد."
    >
      <div className="mb-6">
        <LinkTabs
          label="الشهر"
          items={months.map((m) => ({
            href: m === defaultMonth ? "/payments" : `/payments?month=${m}`,
            label: m === current ? `${formatMonth(m)} (حتى اليوم)` : formatMonth(m),
            active: m === month,
          }))}
        />
      </div>

      {!empty && (() => {
        /*
          بطاقةٌ تقول «٠٫٠٠ — لا شيء» تأخذ مكانَ ما يستحقّ النظر. فما صفرُه
          معلومٌ يُقال سطراً هادئاً تحت البطاقات، والبطاقةُ لما فيه جواب.
          والمجهولُ ليس صفراً: ضريبةٌ لم تُقرأ تبقى بطاقةً «غير معروف».
        */
        const covered = run.coveredByCredit.reduce((s, c) => s + c.creditAppliedMinor, 0);
        const vatUnknownOnly = run.vatAtRiskUnknown > 0 && run.vatAtRiskMinor === 0;
        const calm: string[] = [];
        if (run.held.length === 0) calm.push("لا شيء محجوز");
        if (run.vatAtRiskMinor === 0 && run.vatAtRiskUnknown === 0) calm.push("لا ضريبة مدخلاتٍ تضيع بهذه الدفعة");
        if (covered === 0) calm.push("لا مورّد يغطّيه رصيدُك كلَّه");
        return (
          <>
            <StatGrid>
              <Stat label="جاهزٌ للتحويل" icon={CircleCheck} minor={run.readyTotalMinor} tone="ok" sub={countNoun(run.ready.length, SUPPLIER)} />
              {run.held.length > 0 && (
                <Stat label="محجوزٌ حتى تُعالَج" icon={PauseCircle} minor={run.heldTotalMinor} tone="warn" sub={countNoun(run.held.length, INVOICE)} />
              )}
              {(run.vatAtRiskMinor > 0 || run.vatAtRiskUnknown > 0) && (
                <Stat
                  label="ضريبةٌ معرّضة"
                  icon={ShieldCheck}
                  value={vatUnknownOnly ? "غير معروف" : undefined}
                  minor={vatUnknownOnly ? undefined : run.vatAtRiskMinor}
                  tone={run.vatAtRiskMinor ? "danger" : undefined}
                  sub={run.vatAtRiskUnknown > 0 ? `${run.vatAtRiskMinor > 0 ? "وأكثر: " : ""}${countNoun(run.vatAtRiskUnknown, INVOICE)} بلا ضريبةٍ مقروءة` : undefined}
                />
              )}
              {covered > 0 && (
                <Stat label="يغطّيه رصيدُك عندهم" minor={covered} sub={countNoun(run.coveredByCredit.length, SUPPLIER)} />
              )}
            </StatGrid>
            {calm.length > 0 && (
              <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                <CircleCheck className="h-3.5 w-3.5 shrink-0 text-ok" strokeWidth={2} aria-hidden />
                {calm.join(" · ")}
              </p>
            )}
          </>
        );
      })()}

      {empty ? (
        <EmptyState
          title={`لا مستحقّات في ${formatMonth(month)}`}
          hint="إمّا سُدّد كلُّ شيء، أو لم تُرفع فواتيرُ الشهر بعد. انظر النقد القادم لما يستحقّ بعده."
          action={<Link href="/cash" className="text-sm font-bold text-accent hover:underline">النقد القادم</Link>}
        />
      ) : (
        <>
          {run.ready.length > 0 && (
            <div className="mt-10">
              <PayRunPlanner month={month} suppliers={planner} />
            </div>
          )}

          {run.coveredByCredit.length > 0 && (
            <Section title="يغطّيها رصيدُك عندهم" hint="دفعتَ لهؤلاء مالاً لم يُخصم بعد، ويكفي لفواتير الشهر كلّها — فلا تحوِّل لهم شيئاً.">
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                {run.coveredByCredit.map((s) => (
                  <li key={s.supplierId} className="flex items-center justify-between gap-3 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-sm">
                    <span className="font-bold">{s.supplierName}</span>
                    <span className="text-xs text-ink-soft">رصيدُك يغطّي <Money minor={s.creditAppliedMinor} /></span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {run.held.length > 0 && (
            <Section title="محجوزٌ حتى تُعالَج" count={run.held.length} hint="لا يدخل ملفّ التحويلات. اطلب الفاتورة الصحيحة قبل السداد — والرسالةُ جاهزة.">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
                {[...heldBySupplier].map(([name, list]) => {
                  const reasons = [...new Set(list.map((h) => h.message))];
                  return (
                    <article key={name} className="rounded-xl border border-warn/25 bg-raised p-4 shadow-raised">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="text-sm font-bold">{name}</h3>
                        <span className="text-sm font-bold text-warn">
                          <Money minor={list.reduce((s, h) => s + h.invoice.totalMinor - h.invoice.allocatedMinor, 0)} />
                        </span>
                      </div>
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {list.map((h) => (
                          <li key={h.invoice.invoiceId}>
                            <Link
                              href={invoiceHref(h.invoice.invoiceId, "tax")}
                              className="inline-flex min-h-8 items-center rounded-md bg-sunken px-2 font-mono text-[11px] text-ink-soft hover:text-accent"
                              dir="ltr"
                            >
                              {h.invoice.invoiceNumber}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                        {reasons.length === 1 ? reasons[0] : reasons.map((r) => `• ${r}`).join(" ")}
                      </p>
                      <div className="mt-3">
                        <WhatsAppLink href={`https://wa.me/?text=${encodeURIComponent(buildSupplierMessage(name, list))}`} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}

      <Callout tone="muted" className="mt-10">
        الملفُّ يُبنى في الخادم ممّا اخترته ويُسجَّل تنزيلُه في سجلّ التدقيق. والإقرارُ بالسداد يُكتب باسمك — وحين يصل كشفُ البنك يطابق ما بقي.
        لما يستحقّ بعد هذه الدفعة انظر <Link href="/cash" className="font-bold text-accent hover:underline">النقد القادم</Link>.
      </Callout>
    </PageShell>
  );
}
