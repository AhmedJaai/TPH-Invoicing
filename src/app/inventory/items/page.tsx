import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, DataTable, EmptyState, NoAccess, type Column, buttonClass } from "@/components/ui";
import { Money } from "@/components/money";
import { isStoredUnit, storedUnitLabel } from "@/lib/unit-conversion";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { formatBp } from "@/lib/inventory/equation";

export const dynamic = "force-dynamic";

interface ItemRow {
  id: string;
  name: string;
  category: string;
  baseUnit: string;
  unitLabel: string;
  inRecipes: number;
  lastVarianceBp: number | null;
  lastVarianceCostMinor: number | null;
  countedTimes: number;
}

/**
 * الأصناف — ما يُعَدّ على الرفّ.
 *
 * والعمودُ الذي يستحقّ النظر «في كم وصفة»: صنفٌ في صفر وصفات لا
 * يُحسَب له استهلاكٌ متوقَّع أبداً، فيظهر فرقُه كلَّ أسبوعٍ بحجم ما
 * اشتُري منه — وهو ليس فرقاً بل غيابَ وصفة.
 */
export default async function InventoryItemsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/items");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="wide" title="الأصناف">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const rows = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.name_ar, p.category, p.base_unit,
           (select count(distinct ri.recipe_version_id)::int
              from recipe_ingredients ri
              join recipe_versions rv on rv.id = ri.recipe_version_id
             where ri.product_id = p.id and rv.status = 'ACTIVE') as in_recipes,
           (select count(*)::int from inventory_count_lines l
             where l.product_id = p.id and l.actual_milli is not null) as counted_times,
           (select l.variance_bp from inventory_count_lines l
              join inventory_counts c on c.id = l.count_id
             where l.product_id = p.id and c.status = 'FINALISED'
             order by c.period_end desc limit 1) as last_bp,
           (select l.variance_cost_minor from inventory_count_lines l
              join inventory_counts c on c.id = l.count_id
             where l.product_id = p.id and c.status = 'FINALISED'
             order by c.period_end desc limit 1) as last_cost
      from products p
     where p.is_active and p.is_stock_item
     order by p.category, p.name_ar
  `);

  const items: ItemRow[] = rows.rows.map((r) => {
    const unit = isStoredUnit(r.base_unit) ? r.base_unit : "PIECE";
    return {
      id: String(r.id),
      name: String(r.name_ar),
      category: String(r.category),
      baseUnit: unit,
      unitLabel: storedUnitLabel(unit),
      inRecipes: Number(r.in_recipes ?? 0),
      countedTimes: Number(r.counted_times ?? 0),
      lastVarianceBp: r.last_bp === null ? null : Number(r.last_bp),
      lastVarianceCostMinor: r.last_cost === null ? null : Number(r.last_cost),
    };
  });

  /* من لا يرى المبالغ لا يُعرَض له عمودُ الكلفة — و`inventory:view` ليست `amounts:view` */
  const showAmounts = can(user.role, "amounts:view");

  const columns: readonly Column<ItemRow>[] = [
    {
      key: "name", header: "الصنف", primary: true,
      cell: (r) => <Link href={`/inventory/items/${r.id}`} className="font-bold hover:underline">{r.name}</Link>,
    },
    { key: "unit", header: "وحدةُ القياس", cell: (r) => r.unitLabel },
    {
      key: "category", header: "الباب", secondary: true,
      cell: (r) => CATEGORY_LABEL[r.category as ProductCategory] ?? r.category,
    },
    {
      key: "recipes", header: "في كم وصفة", numeric: true,
      cell: (r) => (
        r.inRecipes === 0
          ? <Badge tone="warn">لا وصفة</Badge>
          : <span className="nums">{r.inRecipes}</span>
      ),
    },
    {
      key: "last", header: "آخرُ فرق", numeric: true,
      cell: (r) => (
        r.lastVarianceBp === null
          ? <span className="text-muted">—</span>
          : <span className="nums">
              {showAmounts && r.lastVarianceCostMinor !== null && (
                <>
                  <Money minor={r.lastVarianceCostMinor} tone={r.lastVarianceCostMinor < 0 ? "danger" : undefined} />{" "}
                </>
              )}
              <span className="text-muted">{formatBp(r.lastVarianceBp)}</span>
            </span>
      ),
    },
    { key: "times", header: "مرّاتُ العدّ", numeric: true, secondary: true, cell: (r) => <span className="nums">{r.countedTimes}</span> },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="الأصناف"
      intro="ما يُعَدّ على الرفّ، ووحدةُ قياس كلٍّ منه. وصنفٌ لا وصفةَ فيه لا يُحسَب له استهلاكٌ متوقَّع."
    >
      <DataTable
        columns={columns}
        rows={items}
        keyOf={(r) => r.id}
        hrefOf={(r) => `/inventory/items/${r.id}`}
        empty={
          <EmptyState
            title="لا صنفَ مخزونٍ مسجَّل بعد."
            hint="تُبنى الأصناف من بنود فواتير المورّدين — ارفع فاتورةً، ثمّ اربط بنودها بأصنافٍ معياريّة."
            action={<Link href="/purchases/products" className={buttonClass("secondary", "sm")}>الأصناف والأسعار</Link>}
          />
        }
      />
    </PageShell>
  );
}
