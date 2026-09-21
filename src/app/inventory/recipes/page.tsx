import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, Card, DataTable, EmptyState, NoAccess, Section, buttonClass, type Column } from "@/components/ui";
import { RecipeEditor } from "@/components/recipe-editor";
import { listRecipes, type RecipeRow } from "@/services/recipe.service";
import { storedUnitLabel } from "@/lib/unit-conversion";
import { todayInRiyadh } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

/**
 * الوصفات — وما بِيع بلا وصفةٍ يُعرَض هنا أيضاً.
 *
 * فالسؤالُ الذي يُفتَح له هذا اللسان ليس «ما وصفاتي؟» بل «**ما الذي
 * ينقص كي يُحسَب جردي؟**». وقائمةُ الموجود وحدها لا تجيبه.
 */
export default async function RecipesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/recipes");
  if (!can(user.role, "recipe:edit")) {
    return (
      <PageShell user={user} width="wide" title="الوصفات">
        <NoAccess what="الوصفات" />
      </PageShell>
    );
  }

  const rows = await listRecipes();

  const menuProducts = await db
    .select({ id: products.id, nameAr: products.nameAr })
    .from(products)
    .where(and(eq(products.isActive, true), eq(products.isMenuItem, true)))
    .orderBy(asc(products.nameAr));

  const ingredients = await db
    .select({ id: products.id, nameAr: products.nameAr, baseUnit: products.baseUnit })
    .from(products)
    .where(and(eq(products.isActive, true), eq(products.isStockItem, true)))
    .orderBy(asc(products.nameAr));

  /* ما بِيع هذا الشهر ولا وصفةَ له — السؤالُ الحقيقيّ في هذه الشاشة */
  const missing = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.name_ar,
           coalesce(sum(sl.line_total_minor), 0)::bigint as sold_minor
      from sale_lines sl
      join pos_products pp on pp.id = sl.pos_product_id
      join products p on p.id = pp.product_id
      left join recipes r on r.product_id = p.id
     where r.id is null
       and not sl.is_void
     group by p.id
     order by sold_minor desc
     limit 20
  `);

  const columns: readonly Column<RecipeRow>[] = [
    { key: "name", header: "الصنف المباع", primary: true, cell: (r) => r.menuProductName },
    {
      key: "active", header: "النسخة السارية",
      cell: (r) => (
        r.activeVersion === null
          ? <Badge tone="warn">مسوّدة — لا تدخل الحساب</Badge>
          : <span className="nums">نسخة {r.activeVersion} من {r.activeFrom}</span>
      ),
    },
    { key: "ingredients", header: "مكوّنات", numeric: true, cell: (r) => <span className="nums">{r.ingredientCount}</span> },
    { key: "versions", header: "عددُ النسخ", numeric: true, secondary: true, cell: (r) => <span className="nums">{r.versions}</span> },
  ];

  return (
    <PageShell
      user={user}
      width="wide"
      title="الوصفات"
      intro="كم يخرج من الرفّ لكلّ ما يُباع. وكلُّ تغييرٍ نسخةٌ بتاريخها، فتبقى تقاريرُ ما مضى كما حُسبت."
    >
      {missing.rows.length > 0 && (
        <Card tone="warn">
          <p className="text-sm font-bold">
            {missing.rows.length} صنفاً بِيع ولا وصفةَ له
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            لا يدخل استهلاكُها الحساب، ويُعلَن ذلك في كلّ تقرير. وهذه أكثرُها مبيعاً:
          </p>
          <p className="mt-2 text-xs">
            {missing.rows.map((r) => String(r.name_ar)).join(" · ")}
          </p>
        </Card>
      )}

      <div className="mt-6">
        <RecipeEditor
          menuProducts={menuProducts.map((p) => ({ id: p.id, name: p.nameAr }))}
          ingredients={ingredients.map((p) => ({
            id: p.id, name: p.nameAr, baseUnit: p.baseUnit, unitLabel: storedUnitLabel(p.baseUnit),
          }))}
          defaultFrom={todayInRiyadh()}
        />
      </div>

      <Section title="الوصفات المسجَّلة">
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(r) => r.recipeId}
          empty={
            <EmptyState
              title="لا وصفةَ مسجَّلة بعد."
              hint="بلا وصفاتٍ لا يُحسَب استهلاكٌ متوقَّع، فلا يُحسَب فرقُ جرد. ابدأ بأكثر ما يُباع."
              action={<Link href="/inventory/mapping" className={buttonClass("secondary", "sm")}>اربط منتجات فودكس أوّلاً</Link>}
            />
          }
        />
      </Section>
    </PageShell>
  );
}
