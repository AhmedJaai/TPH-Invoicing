import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { Empty, PageShell } from "@/components/page-shell";
import { ProductMapping } from "@/components/product-mapping";
import { listProducts, listSupplierProducts, mappingCoverage } from "@/services/product.service";
import { suggestMerges, type SupplierItem } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "supplier:edit")) {
    return (
      <PageShell user={user} active="/purchases" title="الأصناف">
        <Empty message="تعديل الأصناف للمالك والمحاسب." />
      </PageShell>
    );
  }

  const [rows, products, coverage] = await Promise.all([
    listSupplierProducts(),
    listProducts(),
    mappingCoverage(),
  ]);

  const items: SupplierItem[] = rows.map((r) => ({
    supplierId: r.supplierId,
    supplierName: r.supplierName,
    normalized: r.normalized,
    displayName: r.displayName,
    lastUnitPriceMinor: r.lastUnitPriceMinor,
    orderCount: r.orderCount,
  }));

  const suggestions = suggestMerges(items);

  if (rows.length === 0) {
    return (
      <PageShell user={user} active="/purchases" title="الأصناف">
        <Empty message="لا أصناف بعد. تُبنى من بنود الفواتير — اقرأ محتوى فواتيرك أوّلاً." />
      </PageShell>
    );
  }

  return (
    <PageShell
      user={user}
      active="/purchases"
      title="الأصناف"
      intro="اسم الصنف عند مورّده ليس مُعرِّفاً له. الربط بصنف معياري هو ما يجمع ما اشتريتَه من مورّدين مختلفين تحت شيء واحد — وهو أساس كل تحليل تكلفة لاحق."
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">أصناف مورّدين</p>
          <p className="nums mt-1 text-xl font-bold">{coverage.total}</p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">مربوطة بصنف معياري</p>
          <p className={`nums mt-1 text-xl font-bold ${coverage.mapped > 0 ? "text-ok" : ""}`}>
            {coverage.mapped}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-raised px-4 py-3">
          <p className="text-xs text-muted">أصناف معيارية</p>
          <p className="nums mt-1 text-xl font-bold">{products.length}</p>
        </div>
      </div>

      <div className="mt-6">
        <ProductMapping rows={rows} products={products} suggestions={suggestions} />
      </div>
    </PageShell>
  );
}
