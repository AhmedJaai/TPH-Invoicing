import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { BankImport } from "@/components/bank-import";

export const dynamic = "force-dynamic";

export default async function BankPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} active="/bank" title="السداد">
        <Empty message="كشف البنك محجوب عن دورك." />
      </PageShell>
    );
  }

  const [{ open }] = await db
    .select({
      open: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(sql`${invoices.totalMinor} > coalesce((
      select sum(pa.amount_minor)::int from payment_allocations pa where pa.invoice_id = invoices.id
    ), 0) + 1`);

  return (
    <PageShell
      user={user}
      active="/bank"
      title="السداد"
      intro="طريقان لإقفال الفواتير المفتوحة: مطابقة كشف البنك، أو اعتمادها مسدَّدة بإقرارك. الأول أدقّ والثاني أسرع."
    >
      <BankImport openInvoiceCount={Number(open)} />
    </PageShell>
  );
}
