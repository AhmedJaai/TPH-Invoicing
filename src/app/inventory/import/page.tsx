import { redirect } from "next/navigation";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { salesImports } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, EmptyState, NoAccess, Section, buttonClass } from "@/components/ui";
import { InventoryImport } from "@/components/inventory-import";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "muted" }> = {
  IMPORTED: { label: "كامل", tone: "ok" },
  PARTIAL: { label: "جزئيّ", tone: "warn" },
  FAILED: { label: "لم يُستورَد", tone: "danger" },
  DUPLICATE: { label: "مكرَّر", tone: "muted" },
  PENDING: { label: "لم يكتمل", tone: "warn" },
};

/**
 * استيرادُ المبيعات.
 *
 * ── ولماذا سجلُّ الاستيرادات معروض ──
 *
 * «استوردتُ الملفّ» ليست «غُطّيت الفترة». والسجلُّ يقول أيّ فتراتٍ
 * عندنا وأيُّها لم يصل — وهو الفرقُ نفسه الذي أوجب `reconciliation_periods`
 * في كشف البنك.
 */
export default async function SalesImportPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/import");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="page" title="استيراد المبيعات">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const rows = await db
    .select({
      id: salesImports.id,
      fileName: salesImports.fileName,
      status: salesImports.status,
      periodStart: salesImports.periodStart,
      periodEnd: salesImports.periodEnd,
      totalRows: salesImports.totalRows,
      importedRows: salesImports.importedRows,
      errorRows: salesImports.errorRows,
      createdAt: salesImports.createdAt,
    })
    .from(salesImports)
    .orderBy(desc(salesImports.createdAt))
    .limit(30);

  return (
    <PageShell
      user={user}
      width="page"
      title="استيراد المبيعات"
      intro="ملفُّ فودكس يدخل مجالَ المبيعات نفسَه الذي ستدخله الواجهةُ البرمجيّة لاحقاً — فلا يُعاد بناءُ شيء حين تصل."
      actions={<Link href="/inventory/mapping" className={buttonClass("secondary", "sm")}>منتجات تحتاج ربطاً</Link>}
    >
      <InventoryImport canImport={can(user.role, "inventory:count")} />

      <Section title="ما استُورد من قبل">
        {rows.length === 0 ? (
          <EmptyState
            title="لم يُستورَد ملفٌّ بعد."
            hint="ارفع أوّل تصديرٍ من فودكس ليُحسَب أوّلُ جرد."
          />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-xs font-bold">{r.fileName}</span>
                <Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label ?? r.status}</Badge>
                <span className="nums text-[11px] text-muted">
                  {r.periodStart ?? "؟"} → {r.periodEnd ?? "؟"}
                </span>
                <span className="nums text-[11px] text-muted">
                  {r.importedRows} / {r.totalRows} صفّاً
                  {r.errorRows > 0 && <span className="text-danger"> · {r.errorRows} لم يُقرأ</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
