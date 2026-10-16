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
import { loadPnl, loadPurchaseInvoices, type ExpenseRowView, type PurchaseInvoiceRow } from "@/services/profit.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const LINES = ["cogs", "purchases", "opex", "excluded"] as const;
type Line = (typeof LINES)[number];
const TITLE: Record<Line, string> = {
  cogs: "تكلفة المبيعات — ممّ تكوّنت",
  purchases: "مشتريات الشهر — فاتورةً فاتورة",
  opex: "المصروفات التشغيليّة — صفّاً صفّاً",
  excluded: "ما خرج من المصروفات",
};

const invoiceColumns: Column<PurchaseInvoiceRow>[] = [
  { key: "supplier", header: "المورّد", primary: true, cell: (r) => r.supplierName, sortBy: (r) => r.supplierName },
  { key: "number", header: "الفاتورة", cell: (r) => <bdi dir="ltr">{r.invoiceNumber}</bdi> },
  { key: "day", header: "دخلت", cell: (r) => <bdi>{formatDay(r.day)}</bdi>, sortBy: (r) => r.day },
  { key: "net", header: "بلا ضريبة", numeric: true, cell: (r) => <><Money minor={r.netMinor} />{r.grossOnly && <span className="ms-1 text-[10px] text-warn">بإجماليّها</span>}</>, sortBy: (r) => r.netMinor },
];

const opexColumns: Column<ExpenseRowView>[] = [
  { key: "label", header: "البيان", primary: true, cell: (r) => r.label },
  { key: "category", header: "الفئة", cell: (r) => CATEGORY_LABEL[r.category], sortBy: (r) => CATEGORY_LABEL[r.category] },
  { key: "source", header: "من أين", cell: (r) => <Badge tone={r.source === "SPREAD" || r.source === "OFF_BOOK" ? "accent" : "muted"}>{OPEX_SOURCE_LABEL[r.source]}</Badge>, secondary: true },
  { key: "day", header: "اليوم", cell: (r) => (r.occurredOn ? <bdi>{formatDay(r.occurredOn)}</bdi> : "—"), sortBy: (r) => r.occurredOn },
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
  const back = <LinkButton href={`/finance?month=${month}`} variant="quiet" size="sm" icon={ArrowRight}>قائمة دخل {formatMonth(month)}</LinkButton>;

  if (line === "opex" || line === "excluded") {
    const rows = line === "opex" ? view.opexRows.filter((r) => category === null || r.category === category) : [];
    const total = rows.reduce((s, r) => s + r.amountMinor, 0);
    return (
      <PageShell user={user} width="wide" title={category ? `${CATEGORY_LABEL[category]} — ${formatMonth(month)}` : `${TITLE[line]} — ${formatMonth(month)}`} actions={back}
        intro={line === "opex" ? "كلّ صفّ دخل مصروفات الشهر، ومن أين جاء. سداد المورّدين ليس هنا — هو في المشتريات." : "مبالغ خرجت من الكشف وليست مصروف تشغيل."}>
        {line === "opex" ? (
          <>
            <p className="mb-3 text-sm">المجموع: <strong><Money minor={total} currency /></strong> في {rows.length} صفّاً.</p>
            <DataTable
              columns={opexColumns} rows={rows} keyOf={(r) => r.id} sort={q.sort ?? null}
              hrefOf={(r) => (r.declarationId ? `/finance/inputs?month=${month}` : r.bankTransactionId ? `/bank/tx/${r.bankTransactionId}` : undefined)}
              searchOf={(r) => `${r.label} ${CATEGORY_LABEL[r.category]}`}
              empty={<EmptyState icon={Info} title="لا مصروف مقيّداً هنا." hint="ما لا يراه الكشف — راتب نقداً، إيجار من حساب شخصيّ — يدخل من «ما لا يراه الكشف»." />}
            />
            <div className="mt-4"><LinkButton href={`/finance/inputs?month=${month}${category ? `&category=${category}` : ""}`} size="sm">أضف ما لا يراه الكشف</LinkButton></div>
          </>
        ) : (
          <DataTable
            columns={[
              { key: "label", header: "البيان", primary: true, cell: (r) => r.label },
              { key: "reason", header: "لماذا ليس مصروفاً", cell: (r) => r.reason },
              { key: "amount", header: "المبلغ", numeric: true, cell: (r) => <Money minor={r.amountMinor} /> },
            ]}
            rows={view.excludedRows} keyOf={(r) => r.id}
            empty={<EmptyState icon={Info} title="لا شيء مستثنًى هذا الشهر." />}
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
      intro={line === "cogs" ? "تكلفة المبيعات بالجرد = مشتريات الشهر + مخزون أوّله − مخزون آخره. هذه مكوّناتها." : "ما دخلت بضاعته في الشهر من فواتيرنا، بلا ضريبتها وبلا الأصول الثابتة."}>
      {line === "cogs" && (
        stock ? (
          <>
            <Callout tone="info" icon={Info} title="المعادلة بأرقامها">
              مشتريات الشهر <strong><Money minor={stock.purchasesMonthMinor} /></strong> + مخزون عدّ <bdi>{formatDay(stock.openingDay)}</bdi> <strong><Money minor={stock.openingValueMinor} /></strong> − مخزون عدّ <bdi>{formatDay(stock.closingDay)}</bdi> <strong><Money minor={stock.closingValueMinor} /></strong>
              {stock.adjustedDays > 0 && <>، ثمّ سدّت {stock.adjustedDays} أيّام بين العدّ وطرف الشهر بما اشتري وما صرف نظريّاً فيها</>}
              {" "}= <strong><Money minor={stock.minor} currency /></strong>.
              المخزون مقوّم بآخر كلفة معروفة لكلّ صنف عند آخر الشهر — معدّل واحد للطرفين، فتغيّر السعر لا يصير تكلفة.
              ما لا يعدّ (الحلى اليوميّة، الحليب) يحسب مستهلكاً حين يشترى.
            </Callout>
            <Section title="المخزون المعدود في الطرفين" count={stock.items.length} hint="الأصناف التي عدّت في العدّين معاً ولها كلفة معروفة — وحدها تدخل فرق المخزون.">
              <DataTable
                columns={[
                  { key: "name", header: "الصنف", primary: true, cell: (r) => r.name },
                  { key: "open", header: "أوّل الشهر", numeric: true, cell: (r) => <Money minor={r.openingMinor} />, sortBy: (r) => r.openingMinor },
                  { key: "close", header: "آخره", numeric: true, cell: (r) => <Money minor={r.closingMinor} />, sortBy: (r) => r.closingMinor },
                  { key: "delta", header: "نقص المخزون (يزيد التكلفة)", numeric: true, cell: (r) => <Money minor={r.openingMinor - r.closingMinor} signed />, sortBy: (r) => r.openingMinor - r.closingMinor },
                ]}
                rows={stock.items} keyOf={(r) => r.productId} sort={q.sort ?? null}
                hrefOf={(r) => `/finance/stock/item?id=${r.productId}&month=${month}`}
              />
              {stock.suspectItems.length > 0 && (
                <p className="mt-3 text-xs text-warn">أخرجت من الفرق لعدّ مشكوك فيه (قفزة بأكثر من عشرين ضعفاً): {stock.suspectItems.join("، ")}. صحّح العدّ في فودكس أو في الجرد ليدخلا.</p>
              )}
            </Section>
          </>
        ) : (
          <Callout tone="warn" icon={Info} title="لا تكلفة بالجرد لهذا الشهر">
            {view.input.cogs.stockMissing ?? "لا عدّ يفصل المخزون"}. فالمعتمد مشتريات الشهر أدناه — وما بقي منها على الرفّ محسوب كأنّه بيع.
            <div className="mt-3"><LinkButton href="/inventory" size="sm">أدخل الجرد</LinkButton></div>
          </Callout>
        )
      )}
      <Section title="فواتير الشهر" count={invoices.length} hint={`مجموعها بلا ضريبة ${formatRiyalsDisplay(purchasesTotal)} ريال.`}>
        <DataTable
          columns={invoiceColumns} rows={invoices} keyOf={(r) => r.id} sort={q.sort ?? null}
          hrefOf={(r) => `/purchases/invoices/${r.id}`}
          searchOf={(r) => `${r.supplierName} ${r.invoiceNumber}`}
          empty={<EmptyState icon={Info} title="لا فاتورة دخلت في هذا الشهر." />}
        />
      </Section>
    </PageShell>
  );
}
