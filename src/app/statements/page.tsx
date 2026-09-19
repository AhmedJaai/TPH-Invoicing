import { redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, statements, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { StatementReconcile } from "@/components/statement-reconcile";
import Link from "next/link";
import { NoAccess, Section, buttonClass } from "@/components/ui";
import { INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh } from "@/lib/riyadh-time";
import { buildStatementRequest } from "@/lib/supplier-requests";
import { loadMissingStatementSuppliers } from "@/services/supplier-followups.service";

export const dynamic = "force-dynamic";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string; supplier?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/statements");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الكشوف">
        <NoAccess />
      </PageShell>
    );
  }

  const rows = await db
    .select({
      id: statements.id,
      supplierName: suppliers.nameAr,
      periodStart: statements.periodStart,
      periodEnd: statements.periodEnd,
      closingBalanceMinor: statements.closingBalanceMinor,
      fileName: documents.fileName,
      lineCount: sql<number>`(
        select count(*)::int from statement_lines sl where sl.statement_id = statements.id
      )`,
    })
    .from(statements)
    .leftJoin(suppliers, eq(statements.supplierId, suppliers.id))
    .leftJoin(documents, eq(statements.documentId, documents.id))
    /*
      «كشوفه» و«طابقها» في ملفّ المورّد كانت تفتح كشوف الجميع (BTN-032) —
      فالمرشِّح بالمعرّف المختصر، ويُختار المورّد سلفاً في رفع الكشف.
    */
    .where(params.supplier ? eq(suppliers.slug, params.supplier) : undefined)
    .orderBy(desc(statements.periodEnd));

  /*
    «لم يصل كشفه» — الغائبون بأسمائهم (BTN-110). كان التنبيه يفتح هذه
    الصفحة فلا يجد إلّا ما وصل، والغائب لا يُرى في قائمة الواصل.
    والشهر هو الشهر نفسه الذي يعدّ به التنبيه: المنقضي بتوقيت الرياض.
  */
  const missingMonth = previousMonth(currentMonthRiyadh());
  const missing = params.missing === "1" ? await loadMissingStatementSuppliers(missingMonth) : null;

  const supplierRows = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  const focusSupplier = params.supplier ? supplierRows.find((r) => r.slug === params.supplier) ?? null : null;

  return (
    <PageShell
      user={user}
     
      title="الكشوف"
      intro="مقابلة كشف المورّد بفواتيرك. وهذه وحدها تكشف الفاتورة التي حمّلها عليك ولم تصلك — فاتورة ناقصة لا يكشفها تفتيش أرشيفك، لأنّها ليست فيه."
    >
      {missing && (
        <div id="missing" className="mb-8 scroll-mt-28">
          <Section
            title={missing.length === 0
              ? `وصلت كشوف ${missingMonth} كلّها`
              : `${countNoun(missing.length, SUPPLIER)} لم يصل كشفه عن ${missingMonth}`}
            hint="مورّدون لهم فواتير عندنا ولا كشف منهم ينتهي في هذا الشهر. اطلبه منهم، ثمّ ارفعه من «الرفع» وطابقه أدناه."
          >
            {missing.length > 0 && (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
                {missing.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0">
                      <Link href={`/suppliers/${m.slug}`} className="block truncate text-sm font-medium underline-offset-4 hover:underline">
                        {m.nameAr}
                      </Link>
                      <span className="block text-[11px] text-muted">
                        {countNoun(m.invoiceCount, INVOICE)} عندنا
                        {m.lastInvoiceDate && <> · آخرها <bdi className="nums">{m.lastInvoiceDate}</bdi></>}
                      </span>
                    </span>
                    <a
                      href={`https://wa.me/?text=${encodeURIComponent(buildStatementRequest(m.nameAr, missingMonth))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass("secondary", "sm")}
                    >
                      اطلب الكشف (واتساب)
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {params.supplier && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
          {focusSupplier
            ? <>كشوف <span className="font-bold text-ink">{focusSupplier.nameAr}</span> وحده.</>
            : <>لا مورّد نشطاً بهذا المعرّف.</>}
          <Link href="/statements" className="inline-flex min-h-11 items-center underline underline-offset-4 sm:min-h-0">كشوف كلّ المورّدين</Link>
        </p>
      )}

      <StatementReconcile
        archived={rows.map((r) => ({
          id: r.id,
          supplierName: r.supplierName ?? "—",
          periodStart: r.periodStart.toISOString().slice(0, 10),
          periodEnd: r.periodEnd.toISOString().slice(0, 10),
          fileName: r.fileName ?? "",
          closingBalanceMinor: r.closingBalanceMinor,
          lineCount: Number(r.lineCount),
        }))}
        suppliers={supplierRows.map(({ id, nameAr }) => ({ id, nameAr }))}
        initialSupplierId={focusSupplier?.id}
      />
    </PageShell>
  );
}
