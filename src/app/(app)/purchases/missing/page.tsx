import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, CalendarX2, EyeOff, FileQuestion, PackageSearch, ShieldCheck } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, NoAccess, Section } from "@/components/ui";
import { T } from "@/components/i18n/t";
import { DAY, PAYMENT, PRODUCT, SUPPLIER, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { readableQuantity } from "@/lib/finance/quantity";
import {
  ACTIVE_WINDOW_DAYS, STALE_STATEMENT_DAYS, WITNESS_LABEL,
  type MissingInvoice, type StatementCover, type SupplierFacts,
} from "@/lib/missing-invoices";
import { loadMissingInvoices, loadStockLeads } from "@/services/missing-invoices.service";

export const dynamic = "force-dynamic";

const TITLE = "فواتير غائبة";

/** بمَ يشهد كشفُ المورّد — جملةٌ واحدة تُقال بجانب اسمه. */
function CoverNote({ cover }: { cover: StatementCover }) {
  if (cover.state === "DOES_NOT_ISSUE") return <>لا يصدر كشف حساب</>;
  if (cover.state === "NEVER") return <>لم يصل منه كشف حساب قط</>;
  return cover.staleDays > STALE_STATEMENT_DAYS
    ? <T s="آخر كشف ينتهي {0}، قبل {1}" a={[<bdi key="0">{formatDay(cover.through)}</bdi>, countNoun(cover.staleDays, DAY)]} />
    : <T s="كشفه يغطّي حتى {0}" a={[<bdi key="0">{formatDay(cover.through)}</bdi>]} />;
}

interface LeadRow extends MissingInvoice {
  supplier: SupplierFacts;
}

/**
 * فواتيرُ يُحتمل غيابُها — الشهودُ على كلّ مورّدٍ في موضعٍ واحد (`lib/missing-invoices.ts`).
 *
 * قراءةٌ فوق الدفاتر: لا تُنشأ من هنا فاتورةٌ ولا يُمسّ مال. كلُّ سطرٍ يفتح الصفحةَ التي
 * يُحسَم فيها: «الكشوف» لما ذكره كشفُ المورّد، و«فودكس والفواتير» لما أُدخل هناك.
 */
export default async function MissingInvoicesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/purchases/missing");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title={TITLE}>
        <NoAccess what="الفواتير التي يُحتمل غيابها" />
      </PageShell>
    );
  }

  const { board, unattributedFoodics, invoicesInGap, nearMiss } = await loadMissingInvoices();
  const leads: LeadRow[] = board.withLeads.flatMap((r) => r.invoices.map((i) => ({ ...i, supplier: r.supplier })));
  const payments = board.withLeads.flatMap((r) => r.payments.map((p) => ({ ...p, supplier: r.supplier })));
  const watched = board.withLeads.length + board.blind.length + board.clearCount + board.oneOffCount;

  /* قاعدةٌ لا تعرف مورّداً نشِطاً لا تقول «لا فاتورة غائبة» — لم يُفحَص شيء */
  if (watched === 0) {
    return (
      <PageShell user={user} width="wide" title={TITLE} intro="الفواتير التي يشهد عليها كشف المورّد أو فودكس أو البنك وليست في أرشيفك.">
        <EmptyState
          icon={PackageSearch}
          title="لا يوجد مورّد له فاتورة حديثة بعد."
          hint="تظهر هنا القرائن حين تدخل الفواتير والكشوف: ما ذكره المورّد في كشفه، أو أُدخل في فودكس، أو دُفع من البنك، وليس له فاتورة عندك."
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      user={user}
      width="wide"
      title={TITLE}
      eyebrow={<T s="المورّدون الذين لهم فاتورة في آخر {0}" a={[countNoun(ACTIVE_WINDOW_DAYS, DAY)]} />}
      intro="الفاتورة الغائبة ليست في أرشيفك، فلا يكشفها إلا مصدر من خارجه: كشف المورّد، أو ما أُدخل في فودكس، أو حوالة البنك. هنا ما تقوله هذه المصادر لكل مورّد، ومن لا مصدر يؤكّد تعامله."
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={FileQuestion}
          label="فواتير يُحتمل غيابها"
          tone={board.totals.invoices > 0 ? "warn" : "ok"}
          value={<span className="nums">{board.totals.invoices}</span>}
          sub={board.totals.invoices === 0
            ? <T s="لا فاتورة ناقصة عند {0} نعرف تعاملهم من مصدر آخر." a={[countNoun(board.clearCount, SUPPLIER)]} />
            : board.totals.confirmedByTwo > 0
              ? <T s="بمجموع {0}، ومنها {1} أكّدها مصدران." a={[<Money key="0" minor={board.totals.missingMinor} />, <span key="1" className="nums">{board.totals.confirmedByTwo}</span>]} />
              : <T s="بمجموع {0}، وكل منها أكّده مصدر واحد." a={[<Money key="0" minor={board.totals.missingMinor} />]} />}
          href="#leads"
        />
        <KeyFigure
          icon={Banknote}
          label="دفعت ولم تصل الفاتورة"
          tone={payments.length > 0 ? "warn" : "ok"}
          value={payments.length > 0 ? <Money minor={board.totals.unbackedMinor} /> : <span className="nums">0</span>}
          sub={payments.length > 0
            ? <T s="{0} لم تفسّرها فاتورة. لا تُجمع إلى الفواتير الغائبة، فقد تكون هي نفسها." a={[countNoun(payments.length, PAYMENT)]} />
            : "كل ما دفعته لمورّد يصدر فواتير تفسّره فاتورة."}
          href="#payments"
        />
        <KeyFigure
          icon={EyeOff}
          label="مورّدون بلا مصدر يؤكّد تعاملهم"
          tone={board.blind.length > 0 ? "warn" : "ok"}
          value={<span className="nums">{board.blind.length}</span>}
          sub={board.blind.length > 0
            ? "لا كشف حديث ولا ربط بفودكس: لو غابت فاتورة منهم لما ظهرت هنا."
            : "كل مورّد يتكرر تعامله عليه كشف حديث أو ربط بفودكس."}
          href="#blind"
        />
      </div>

      <Section
        id="leads"
        title="قرائن على فواتير غائبة"
        icon={FileQuestion}
        count={leads.length}
        hint="كل سطر شراءٌ ذكره مصدر من خارج أرشيفك ولا فاتورة له عندك. وما ذكره مصدران بالمبلغ نفسه في أسبوع واحد سطر واحد لا سطران. اضغط السطر لتحسمه في صفحته."
        className="mt-8"
      >
        {leads.length === 0 ? (
          <EmptyState
            compact
            icon={ShieldCheck}
            title="لا فاتورة ناقصة نعرفها."
            hint="كل ما ذكرته كشوف المورّدين وما أُدخل في فودكس له فاتورة عندك. هذا لا يشمل المورّدين الذين لا مصدر يؤكّد تعاملهم أدناه."
          />
        ) : (
          <DataTable
            rows={leads}
            keyOf={(l) => `${l.supplier.id}:${l.key}`}
            hrefOf={(l) => (l.witnesses.includes("STATEMENT") ? `/statements?supplier=${encodeURIComponent(l.supplier.slug)}` : `/purchases/foodics?p=${encodeURIComponent(l.foodicsPurchaseId ?? "")}`)}
            searchOf={(l) => `${l.supplier.name} ${l.ref ?? ""}`}
            columns={[
              { key: "supplier", header: "المورّد", primary: true, cell: (l) => <span className="font-semibold">{l.supplier.name}</span> },
              { key: "day", header: "التاريخ", cell: (l) => <bdi className="whitespace-nowrap text-ink-soft">{formatDay(l.day)}</bdi> },
              {
                key: "ref", header: "رقمها",
                cell: (l) => l.ref
                  ? <span><bdi dir="ltr" className="nums">{l.ref}</bdi>{l.unclear && <span className="ms-2 text-xs text-warn">رقم غير واضح، قد تكون عندك برقم آخر</span>}</span>
                  : <span className="text-muted">غير معروف</span>,
              },
              {
                key: "witness", header: "من شهد", wrap: true,
                cell: (l) => (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {l.witnesses.map((w) => <Badge key={w} tone={l.witnesses.length > 1 ? "warn" : "muted"}>{WITNESS_LABEL[w]}</Badge>)}
                    {l.foodicsPurchaseId && nearMiss[l.foodicsPurchaseId] && (
                      <span className="text-xs text-ink-soft">
                        <T s="ربما هي {0} عندك ({1})" a={[<bdi key="0" dir="ltr" className="font-mono">{nearMiss[l.foodicsPurchaseId].invoiceNumber}</bdi>, formatDay(nearMiss[l.foodicsPurchaseId].day)]} />
                      </span>
                    )}
                  </span>
                ),
              },
              { key: "amount", header: "المبلغ", numeric: true, cell: (l) => <Money minor={l.amountMinor} /> },
            ]}
          />
        )}
        {unattributedFoodics.count > 0 && (
          <Callout tone="info" className="mt-4" action={<Link href="/purchases/foodics#only-foodics" className="font-semibold text-accent underline-offset-4 hover:underline">افتح فودكس والفواتير</Link>}>
            <T
              s="وفي فودكس {0} شراء بمجموع {1} بلا فاتورة عندك ومورّدها هناك غير مربوط بمورّد عندك، فلا تُنسب إلى أحد هنا."
              a={[<span key="0" className="nums">{unattributedFoodics.count}</span>, <Money key="1" minor={unattributedFoodics.totalMinor} />]}
            />
          </Callout>
        )}
      </Section>

      {payments.length > 0 && (
        <Section
          id="payments"
          title="دفعت ولم تصل الفاتورة"
          icon={Banknote}
          count={payments.length}
          hint="مال خرج لمورّد يصدر فواتير، وما بقي منه لا تفسّره فاتورة. إما أن فاتورته لم تصل، وإما أنه سداد مقدَّم."
          className="mt-8"
        >
          <DataTable
            rows={payments}
            keyOf={(p) => p.paymentId}
            hrefOf={(p) => `/suppliers/${encodeURIComponent(p.supplier.slug)}`}
            columns={[
              { key: "supplier", header: "المورّد", primary: true, cell: (p) => <span className="font-semibold">{p.supplier.name}</span> },
              { key: "day", header: "يوم الدفع", cell: (p) => <bdi className="whitespace-nowrap text-ink-soft">{formatDay(p.day)}</bdi> },
              { key: "cover", header: "كشفه", wrap: true, cell: (p) => <span className="text-xs text-ink-soft"><CoverNote cover={board.withLeads.find((r) => r.supplier.id === p.supplier.id)!.cover} /></span> },
              { key: "amount", header: "بلا فاتورة", numeric: true, cell: (p) => <Money minor={p.unbackedMinor} /> },
            ]}
          />
        </Section>
      )}

      <Section
        id="blind"
        title="مورّدون بلا مصدر يؤكّد تعاملهم"
        icon={EyeOff}
        count={board.blind.length}
        hint="يصدرون فواتير ولهم فاتورتان فأكثر حديثاً، ولا كشف حساب حديثاً منهم ولا ربط بفودكس. فاتورة تغيب منهم لا يكشفها شيء حتى تُدفع. اطلب كشف حسابه، أو اربط مورّده في فودكس."
        className="mt-8"
      >
        {board.blind.length === 0 ? (
          <EmptyState compact icon={ShieldCheck} title="كل مورّد يتكرر تعامله له مصدر يؤكّده." hint="لكل منهم كشف حساب حديث أو ربط بمورّده في فودكس." />
        ) : (
          <DataTable
            rows={board.blind}
            keyOf={(r) => r.supplier.id}
            hrefOf={(r) => `/suppliers/${encodeURIComponent(r.supplier.slug)}`}
            columns={[
              { key: "supplier", header: "المورّد", primary: true, cell: (r) => <span className="font-semibold">{r.supplier.name}</span> },
              { key: "why", header: "لماذا لا نعرف", wrap: true, cell: (r) => <span className="text-xs text-ink-soft"><CoverNote cover={r.cover} />، وغير مربوط بفودكس</span> },
              { key: "last", header: "آخر فاتورة", cell: (r) => <bdi className="whitespace-nowrap text-ink-soft">{formatDay(r.supplier.lastInvoiceDay)}</bdi> },
              { key: "billed", header: "مجموع فواتيره الحديثة", numeric: true, cell: (r) => <Money minor={r.supplier.recentBilledMinor} /> },
              { key: "count", header: "عددها", numeric: true, cell: (r) => <span className="nums">{r.supplier.recentInvoices}</span> },
            ]}
          />
        )}
        {board.oneOffCount > 0 && (
          <p className="mt-3 text-xs text-ink-soft">
            <T s="و{0} بلا مصدر لهم فاتورة واحدة في المدة (شراء مرة واحدة)، فلا يُسأل عنهم هنا." a={[countNoun(board.oneOffCount, SUPPLIER)]} />
          </p>
        )}
      </Section>

      {board.coverGaps.length > 0 && (
        <Section
          id="gaps"
          title="أيام بين كشفين"
          icon={CalendarX2}
          count={board.coverGaps.length}
          hint="كشفان للمورّد نفسه بينهما أسبوع فأكثر لم يذكر أي منهما فيه شيئاً. مدة الكشف تُقرأ من تواريخ أسطره، فقد تكون أياماً بلا توريد. فإن كانت لك فواتير فيها فلم يفحصها كشف: اطلب كشفاً يغطّيها."
          className="mt-8"
        >
          <DataTable
            rows={board.coverGaps}
            keyOf={(g) => `${g.supplier.id}:${g.from}`}
            hrefOf={(g) => `/statements?supplier=${encodeURIComponent(g.supplier.slug)}`}
            columns={[
              { key: "supplier", header: "المورّد", primary: true, cell: (g) => <span className="font-semibold">{g.supplier.name}</span> },
              { key: "range", header: "الأيام غير المغطّاة", wrap: true, cell: (g) => <T s="من {0} إلى {1}" a={[<bdi key="0">{formatDay(g.from)}</bdi>, <bdi key="1">{formatDay(g.to)}</bdi>]} /> },
              { key: "days", header: "عددها", numeric: true, cell: (g) => <span className="nums">{g.days}</span> },
              {
                key: "ours", header: "فواتيرك فيها", numeric: true,
                cell: (g) => {
                  const n = invoicesInGap[`${g.supplier.id}:${g.from}`] ?? 0;
                  return n > 0 ? <span className="nums font-semibold text-warn">{n}</span> : <span className="nums text-muted">0</span>;
                },
              },
            ]}
          />
        </Section>
      )}

      <Suspense fallback={<p className="mt-8 rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">يحسب ما يقوله المخزون: المشترى والمباع منذ البداية…</p>}>
        <StockLeads />
      </Suspense>
    </PageShell>
  );
}

/**
 * قرينةُ المخزون — تُحمَّل بعد ما فوقها (تمرّ على كلّ المبيعات منذ البداية) ولا تدخل مجموعَ
 * اللوحة: أضعفُ الشهود، ويُقال ذلك فوقها.
 */
async function StockLeads() {
  const leads = await loadStockLeads();
  if (leads.length === 0) return null;
  const known = leads.filter((l) => l.shortMinor !== null);
  const total = known.reduce((s, l) => s + (l.shortMinor ?? 0), 0);
  return (
    <Section
      id="stock"
      title="المخزون يقول: صُرف أكثر مما اشتُري"
      icon={PackageSearch}
      count={leads.length}
      hint="أصناف صرفت منها الوصفات منذ البداية أكثر مما سُجّل شراؤه. هذه أضعف القرائن ولا تدخل الأرقام أعلاه: قد تكون فاتورة غائبة، أو بند فاتورة لم يُربط بصنفه، أو وصفة تصرف أكثر من الواقع. ابدأ بربط البنود."
      className="mt-8"
      action={<Link href="/finance/stock/links" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">اربط بنود الفواتير</Link>}
    >
      <p className="mb-3 text-sm text-ink-soft">
        <T s="قيمة ما صُرف فوق المشترى {0} في {1}." a={[<Money key="0" minor={total} currency />, countNoun(known.length, PRODUCT)]} />
      </p>
      <DataTable
        rows={leads}
        keyOf={(l) => l.productId}
        hrefOf={() => "/finance/stock"}
        searchOf={(l) => `${l.name} ${l.suppliers.map((s) => s.name).join(" ")}`}
        columns={[
          { key: "name", header: "الصنف", primary: true, cell: (l) => <span className="font-semibold">{l.name}</span> },
          { key: "short", header: "صُرف فوق المشترى", cell: (l) => <span className="nums whitespace-nowrap">{readableQuantity(l.shortMilli, l.baseUnit)}</span> },
          {
            key: "suppliers", header: "مورّدوه في فواتيرك", wrap: true,
            cell: (l) => l.suppliers.length === 0
              ? <span className="text-muted">لا بند فاتورة مربوط به</span>
              : <span className="text-ink-soft">{l.suppliers.map((s) => s.name).join("، ")}</span>,
          },
          {
            key: "unlinked", header: "بنودهم غير المربوطة", numeric: true,
            cell: (l) => (l.suppliers.length === 0 ? <span className="text-muted">غير معروف</span> : <Money minor={l.suppliersUnlinkedMinor} />),
          },
          { key: "value", header: "قيمته", numeric: true, cell: (l) => (l.shortMinor === null ? <span className="text-muted">غير معروف</span> : <Money minor={l.shortMinor} />) },
        ]}
      />
    </Section>
  );
}
