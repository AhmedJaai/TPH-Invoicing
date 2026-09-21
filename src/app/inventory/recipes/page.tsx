import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Card, EmptyState, NoAccess, Section, buttonClass } from "@/components/ui";
import { RecipeEditor } from "@/components/recipe-editor";
import { RecipeRows } from "@/components/recipe-rows";
import { listRecipes } from "@/services/recipe.service";
import { storedUnitLabel } from "@/lib/unit-conversion";
import { Money } from "@/components/money";
import { declaredCostDisagrees } from "@/lib/inventory/recipe-cost";
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

  /*
    ── وصفةٌ فيها التغليفُ وحدَه ──

    الكلفةُ المعلَنة عند المصدر تخالف مجموعَ الوصفة مخالفةً كبيرة.
    وذلك يقع حين يسقط **جوهرُ الصنف** من وصفته: «تشيز مدريد» وصفتُه
    شوكةٌ وعلبةٌ بـ٠٫٧٦ ريالاً والمعلَنة ٩٫١٧ — والكعكةُ ليست فيها.
    فكلُّ قطعةٍ تُباع لا تُخصَم من المخزون، ويظهر ما اشتُري منها
    كلُّه «فرقاً» في آخر الأسبوع.
  */
  const suspicious = rows.filter((r) => declaredCostDisagrees(r.costMinor, r.declaredCostMinor));

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

      {suspicious.length > 0 && (
        <Card tone="warn" className="mt-4">
          <p className="text-sm font-bold">
            {suspicious.length} وصفةً كلفتُها أبعدُ من الكلفة المعلَنة عند فودكس
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            وأكثرُ ما يسبّبه أنّ جوهرَ الصنف ليس في وصفته — تُحسَب العلبةُ والشوكة ولا
            تُحسَب الكعكة. فلا يُخصَم المبيعُ من المخزون، ويظهر ما اشتُري كلُّه «فرقاً».
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {suspicious.map((r) => (
              <li key={r.recipeId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-bold">{r.menuProductName}</span>
                <span className="text-muted">
                  وصفتُه <Money minor={r.costMinor!} /> والمعلَنة <Money minor={r.declaredCostMinor!} />
                </span>
              </li>
            ))}
          </ul>
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
        {/*
          الصفُّ يتمدّد في مكانه — فمراجعةُ ستّين وصفةً لا تكون ستّين
          ذهاباً وإياباً بين صفحتين، ولا يفقد المراجعُ موضعَه من القائمة.
        */}
        {rows.length === 0 ? (
          <EmptyState
            title="لا وصفةَ مسجَّلة بعد."
            hint={
              "بلا وصفاتٍ لا يُحسَب استهلاكٌ متوقَّع، فلا يُحسَب فرقُ جرد. "
              + "وكتالوج فودكس يُنشئها كلَّها دفعةً واحدة — أصنافَ المخزون، والأصنافَ المباعة، "
              + "والوصفاتِ وربطَها بنقاط البيع — فلا تُكتب واحدةً واحدة."
            }
            action={
              <Link href="/inventory/import" className={buttonClass("primary", "sm")}>
                ارفع كتالوج فودكس
              </Link>
            }
          />
        ) : (
          <RecipeRows
            rows={rows}
            choices={ingredients.map((p) => ({ id: p.id, name: p.nameAr, baseUnit: p.baseUnit }))}
            defaultChangeFrom={todayInRiyadh()}
          />
        )}
      </Section>
    </PageShell>
  );
}
