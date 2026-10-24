import { redirect } from "next/navigation";
import { ArrowRight, Info } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Callout, DataTable, EmptyState, LinkButton, NoAccess, Section, type Column } from "@/components/ui";
import { CATEGORY_LABEL, isTxCategory } from "@/lib/bank/rules";
import { OPEX_SOURCE_LABEL } from "@/lib/finance/pnl";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay, formatMonth, monthEndDay } from "@/lib/riyadh-time";
import { LINE, countNoun } from "@/lib/arabic";
import { loadPnl, loadPurchaseInvoices, visibleOpexRows, type ExpenseRowView, type PurchaseInvoiceRow } from "@/services/profit.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LINES = ["cogs", "purchases", "opex", "excluded"] as const;
type Line = (typeof LINES)[number];
const TITLE: Record<Line, string> = {
  cogs: "تكلفة المبيعات ومكوّناتها",
  purchases: "مشتريات الشهر فاتورةً فاتورة",
  opex: "المصروفات التشغيلية بالتفصيل",
  excluded: "ما استُبعد من المصروفات",
};

const invoiceColumns: Column<PurchaseInvoiceRow>[] = [
  { key: "supplier", header: "المورّد", primary: true, cell: (r) => r.supplierName, sortBy: (r) => r.supplierName },
  { key: "number", header: "الفاتورة", cell: (r) => <bdi dir="ltr">{r.invoiceNumber}</bdi> },
  { key: "day", header: "تاريخ الاستلام", cell: (r) => <bdi>{formatDay(r.day)}</bdi>, sortBy: (r) => r.day },
  { key: "net", header: "بدون ضريبة", numeric: true, cell: (r) => <><Money minor={r.netMinor} />{r.grossOnly && <span className="ms-1 text-[10px] text-warn">بإجماليها</span>}</>, sortBy: (r) => r.netMinor },
];

const opexColumns: Column<ExpenseRowView>[] = [
  { key: "label", header: "الوصف", primary: true, cell: (r) => r.label },
  { key: "category", header: "التصنيف", cell: (r) => CATEGORY_LABEL[r.category], sortBy: (r) => CATEGORY_LABEL[r.category] },
  { key: "source", header: "المصدر", cell: (r) => <Badge tone={r.source === "SPREAD" || r.source === "OFF_BOOK" ? "accent" : "muted"}>{OPEX_SOURCE_LABEL[r.source]}</Badge>, secondary: true },
  { key: "day", header: "التاريخ", cell: (r) => (r.occurredOn ? <bdi>{formatDay(r.occurredOn)}</bdi> : "—"), sortBy: (r) => r.occurredOn },
  { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <Money minor={r.amountMinor} />, sortBy: (r) => r.amountMinor },
];

/**
 * الصفوفُ التي كوّنت رقماً في قائمة الدخل — كلُّ سطرٍ هناك ينتهي هنا، وكلُّ صفٍّ هنا
 * يفتح سجلَّه (الفاتورة، حركة البنك، الإقرار).
 */
export default async function FinanceRowsPage({ searchParams }: { searchParams: Promise<{ month?: string; line?: string; category?: string; sort?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="تفصيل الرقم"><NoAccess what="تفصيل قائمة الدخل" /></PageShell>;
  }
  const q = await searchParams;
  if (!q.month || !MONTH_RE.test(q.month)) redirect("/finance");
  const month = q.month;
  const line: Line = LINES.find((l) => l === q.line) ?? "opex";
  const category = q.category && isTxCategory(q.category) ? q.category : null;
  const view = await loadPnl(month);
  /* الرواتبُ سطراً واحداً لمن لا يملك `payroll:view` */
  const opexShown = visibleOpexRows(view.opexRows, user.role);
  const back = <LinkButton href={`/finance?month=${month}`} variant="quiet" size="sm" icon={ArrowRight}><T s="قائمة دخل {0}" a={[formatMonth(month)]} /></LinkButton>;

  if (line === "opex" || line === "excluded") {
    const rows = line === "opex" ? opexShown.filter((r) => category === null || r.category === category) : [];
    const total = rows.reduce((s, r) => s + r.amountMinor, 0);
    return (
      <PageShell user={user} width="wide" title={category ? `${CATEGORY_LABEL[category]} — ${formatMonth(month)}` : `${TITLE[line]} — ${formatMonth(month)}`} actions={back}
        intro={line === "opex" ? "كل بند دخل في مصروفات الشهر ومصدره. سداد المورّدين ليس هنا، لأنه محسوب في المشتريات." : "مبالغ خرجت في الكشف وليست مصروفات تشغيلية."}>
        {line === "opex" ? (
          <>
            <p className="mb-3 text-sm"><T s="المجموع: {0} في {1}." a={[<strong key="0"><Money minor={total} currency /></strong>, countNoun(rows.length, LINE)]} /></p>
            <DataTable
              columns={opexColumns} rows={rows} keyOf={(r) => r.id} sort={q.sort ?? null}
              hrefOf={(r) => (r.declarationId ? `/finance/inputs?month=${month}` : r.bankTransactionId ? `/bank/tx/${r.bankTransactionId}` : undefined)}
              searchOf={(r) => `${r.label} ${CATEGORY_LABEL[r.category]}`}
              empty={<EmptyState icon={Info} title="لا توجد مصروفات مسجّلة هنا." hint="ما لا يظهر في الكشف، كالراتب النقدي أو الإيجار من حساب شخصي، تضيفه من «ما لا يظهر في الكشف»." />}
            />
            <div className="mt-4"><LinkButton href={`/finance/inputs?month=${month}${category ? `&category=${category}` : ""}`} size="sm">أضف ما لا يظهر في الكشف</LinkButton></div>
          </>
        ) : (
          <DataTable
            columns={[
              { key: "label", header: "الوصف", primary: true, cell: (r) => r.label },
              { key: "reason", header: "سبب الاستبعاد", cell: (r) => r.reason },
              { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <Money minor={r.amountMinor} /> },
            ]}
            rows={view.excludedRows} keyOf={(r) => r.id}
            empty={<EmptyState icon={Info} title="لا توجد مبالغ مستبعدة هذا الشهر." />}
          />
        )}
      </PageShell>
    );
  }

  const from = `${month}-01`;
  const to = monthEndDay(month);
  const invoices = await loadPurchaseInvoices(from, to);
  const purchasesTotal = invoices.reduce((s, r) => s + r.netMinor, 0);
  const stock = view.stock;

  return (
    <PageShell user={user} width="wide" title={`${TITLE[line]} — ${formatMonth(month)}`} actions={back}
      intro={line === "cogs" ? "تكلفة المبيعات بالجرد = مشتريات الشهر + مخزون أول الشهر − مخزون آخره. وهذه مكوّناتها." : "الفواتير التي دخلت بضاعتها في هذا الشهر، بدون ضريبتها وبدون الأصول الثابتة."}>
      {line === "cogs" && (
        stock ? (
          <>
            <Callout tone="info" icon={Info} title="المعادلة بالأرقام">
              <T s="مشتريات الشهر {0} + مخزون عُدّ في {1} {2} − مخزون عُدّ في {3} {4}{5} = {6}. يُقيَّم المخزون بآخر تكلفة معروفة لكل صنف في نهاية الشهر، وبسعر واحد للطرفين، فلا يتحول تغيّر السعر إلى تكلفة. وما لا يُعدّ (كالحلويات اليومية والحليب) يُحسب مستهلكاً عند شرائه." a={[<strong key="0"><Money minor={stock.purchasesMonthMinor} /></strong>, <bdi key="1">{formatDay(stock.openingDay)}</bdi>, <strong key="2"><Money minor={stock.openingValueMinor} /></strong>, <bdi key="3">{formatDay(stock.closingDay)}</bdi>, <strong key="4"><Money minor={stock.closingValueMinor} /></strong>, stock.adjustedDays > 0 && <><T s="، ثم عُدّلت الأيام ({0}) بين يوم العدّ ونهاية الشهر بما اشتُري وما يُفترض أنه صُرف فيها" a={[stock.adjustedDays]} /></>, <strong key="6"><Money minor={stock.minor} currency /></strong>]} /></Callout>
            <Section title="المخزون المعدود في البداية والنهاية" count={stock.items.length} hint="الأصناف التي عُدّت في الجردين ولها تكلفة معروفة، وهي وحدها التي تدخل في فرق المخزون.">
              <DataTable
                columns={[
                  { key: "name", header: "الصنف", primary: true, cell: (r) => r.name },
                  { key: "open", header: "أول الشهر", numeric: true, cell: (r) => <Money minor={r.openingMinor} />, sortBy: (r) => r.openingMinor },
                  { key: "close", header: "آخر الشهر", numeric: true, cell: (r) => <Money minor={r.closingMinor} />, sortBy: (r) => r.closingMinor },
                  { key: "delta", header: "نقص المخزون (يرفع التكلفة)", numeric: true, cell: (r) => <Money minor={r.openingMinor - r.closingMinor} signed />, sortBy: (r) => r.openingMinor - r.closingMinor },
                ]}
                rows={stock.items} keyOf={(r) => r.productId} sort={q.sort ?? null}
                hrefOf={(r) => `/finance/stock/item?id=${r.productId}&month=${month}`}
              />
              {stock.suspectItems.length > 0 && (
                <p className="mt-3 text-xs text-warn"><T s="استُبعدت من الفرق للاشتباه في عدّها (قفزة بأكثر من عشرين ضعفاً): {0}. صحّح العدّ في فودكس أو في الجرد لتدخل في الحساب." a={[stock.suspectItems.join("، ")]} /></p>
              )}
            </Section>
          </>
        ) : (
          <Callout tone="warn" icon={Info} title="لا توجد تكلفة بالجرد لهذا الشهر">
            <T s="{0}. لذلك تُعتمد مشتريات الشهر أدناه، وما بقي منها على الرف يُحسب كأنه بيع.{1}" a={[view.input.cogs.stockMissing ?? "لا يوجد جرد يفصل المخزون", <div key="1" className="mt-3"><LinkButton href="/inventory" size="sm">أدخل الجرد</LinkButton></div>]} /></Callout>
        )
      )}
      <Section title="فواتير الشهر" count={invoices.length} hint={`مجموعها بدون ضريبة ${formatRiyalsDisplay(purchasesTotal)} ريال.`}>
        <DataTable
          columns={invoiceColumns} rows={invoices} keyOf={(r) => r.id} sort={q.sort ?? null}
          hrefOf={(r) => `/purchases/invoices/${r.id}`}
          searchOf={(r) => `${r.supplierName} ${r.invoiceNumber}`}
          empty={<EmptyState icon={Info} title="لا توجد فواتير دخلت بضاعتها في هذا الشهر." />}
        />
      </Section>
    </PageShell>
  );
}
