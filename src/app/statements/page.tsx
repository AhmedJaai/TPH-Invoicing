import { redirect } from "next/navigation";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, statements, suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { StatementReconcile } from "@/components/statement-reconcile";

export const dynamic = "force-dynamic";

export default async function StatementsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="كشوف المورّدين">
        <Empty message="دورك لا يشمل الأرقام المالية، فهذه الصفحة محجوبة عنك." />
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
    .orderBy(desc(statements.periodEnd));

  const supplierRows = await db
    .select({ id: suppliers.id, nameAr: suppliers.nameAr })
    .from(suppliers)
    .where(eq(suppliers.isActive, true))
    .orderBy(asc(suppliers.nameAr));

  return (
    <PageShell
      user={user}
     
      title="كشوف المورّدين"
      intro="مقابلة كشف المورّد بفواتيرك. وهذه وحدها تكشف الفاتورة التي حمّلها عليك ولم تصلك — فاتورة ناقصة لا يكشفها تفتيش أرشيفك، لأنّها ليست فيه."
    >
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
        suppliers={supplierRows}
      />
    </PageShell>
  );
}
