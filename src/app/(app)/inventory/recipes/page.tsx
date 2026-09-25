import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { BookOpen, Scale, TriangleAlert, Upload } from "lucide-react";
import { Callout, LinkButton, NoAccess, Section } from "@/components/ui";
import { RECIPE } from "@/components/inventory-ui";
import { PRODUCT, countNoun } from "@/lib/arabic";
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

  const canWriteManually = menuProducts.length > 0 && ingredients.length > 0;

  return (
    <PageShell
      user={user}
      width="wide"
      title="الوصفات"
      intro="كم يخرج من الرفّ لكلّ ما يُباع. وكلُّ تغييرٍ نسخةٌ بتاريخها، فتبقى تقاريرُ ما مضى كما حُسبت."
      actions={canWriteManually && rows.length > 0 ? (
        <RecipeEditor
          menuProducts={menuProducts.map((p) => ({ id: p.id, name: p.nameAr }))}
          ingredients={ingredients.map((p) => ({
            id: p.id, name: p.nameAr, baseUnit: p.baseUnit, unitLabel: storedUnitLabel(p.baseUnit),
          }))}
          defaultFrom={todayInRiyadh()}
        />
      ) : undefined}
    >
      {rows.length === 0 ? (
        /*
          ── الفراغُ يقول ما يملؤه ──

          بلا وصفاتٍ لا يُحسَب استهلاكٌ متوقَّع، فلا يُحسَب فرقُ جرد. والكتالوجُ
          يُنشئها كلَّها دفعةً واحدة — فلا تُكتب واحدةً واحدة، وكتابتُها يدوياً
          طريقٌ ثانٍ لا أوّل.
        */
        <section className="rounded-2xl border border-accent-line bg-accent-soft/50 px-5 py-10 text-center sm:px-10">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-accent-ink">
            <BookOpen className="h-6 w-6" strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-bold">لا وصفةَ مسجَّلة بعد</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-soft">
            بلا وصفاتٍ لا يُعرَف ما صرفته المبيعات، فلا يُحسَب فرقُ جرد. وكتالوجُ فودكس يُنشئها كلَّها دفعةً واحدة —
            أصنافَ المخزون، والأصنافَ المباعة، والوصفاتِ وربطَها بنقاط البيع.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <LinkButton href="/inventory/import#catalog" variant="primary" icon={Upload}>ارفع كتالوج فودكس</LinkButton>
            {canWriteManually && (
              <RecipeEditor
                variant="secondary"
                menuProducts={menuProducts.map((p) => ({ id: p.id, name: p.nameAr }))}
                ingredients={ingredients.map((p) => ({
                  id: p.id, name: p.nameAr, baseUnit: p.baseUnit, unitLabel: storedUnitLabel(p.baseUnit),
                }))}
                defaultFrom={todayInRiyadh()}
              />
            )}
          </div>
          {!canWriteManually && (
            <p className="mx-auto mt-4 max-w-md text-[11px] leading-relaxed text-muted">
              {menuProducts.length === 0
                ? "ولا صنفَ مباعاً مسجَّلٌ بعد تُكتب له وصفةٌ يدوياً — يُنشئ الكتالوجُ ما يُباع."
                : "ولا صنفَ مخزونٍ يكون مكوّناً بعد."}
            </p>
          )}
        </section>
      ) : (
        <>
          {(missing.rows.length > 0 || suspicious.length > 0) && (
            <div className="mb-8 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
              {missing.rows.length > 0 && (
                <Callout tone="warn" icon={TriangleAlert} title={`${countNoun(missing.rows.length, PRODUCT)} بِيع ولا وصفةَ له`}>
                  <p>لا يدخل استهلاكُها الحساب، ويُعلَن ذلك في كلّ تقرير. أكثرُها مبيعاً:</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {missing.rows.map((r) => (
                      <li key={String(r.id)} className="rounded-md bg-raised/80 px-2 py-0.5 font-medium text-ink">{String(r.name_ar)}</li>
                    ))}
                  </ul>
                </Callout>
              )}

              {/*
                ── وصفةٌ فيها التغليفُ وحدَه ──

                الكلفةُ المعلَنة عند المصدر تخالف مجموعَ الوصفة مخالفةً كبيرة.
                وذلك يقع حين يسقط **جوهرُ الصنف** من وصفته: «تشيز مدريد» وصفتُه
                شوكةٌ وعلبةٌ بـ٠٫٧٦ ريالاً والمعلَنة ٩٫١٧ — والكعكةُ ليست فيها.
              */}
              {suspicious.length > 0 && (
                <Callout tone="warn" icon={Scale} title={`${countNoun(suspicious.length, RECIPE)} كلفتُها أبعدُ من المعلَنة عند فودكس`}>
                  <p>وأكثرُ ما يسبّبه أنّ جوهرَ الصنف ليس في وصفته — تُحسَب العلبةُ والشوكة ولا تُحسَب الكعكة.</p>
                  <ul className="mt-2 space-y-1">
                    {suspicious.map((r) => (
                      <li key={r.recipeId} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-bold text-ink">{r.menuProductName}</span>
                        <span>وصفتُه <Money minor={r.costMinor!} /> والمعلَنة <Money minor={r.declaredCostMinor!} /></span>
                      </li>
                    ))}
                  </ul>
                </Callout>
              )}
            </div>
          )}

          <Section
            title="الوصفات المسجَّلة"
            icon={BookOpen}
            count={rows.length}
            className="mt-0!"
            hint="افتح وصفةً لتصحّحها في مكانها أو تغيّرها بتاريخ — الصفُّ يتمدّد، فلا تفقد موضعك من القائمة."
          >
            <RecipeRows
              rows={rows}
              choices={ingredients.map((p) => ({ id: p.id, name: p.nameAr, baseUnit: p.baseUnit }))}
              defaultChangeFrom={todayInRiyadh()}
            />
          </Section>
        </>
      )}
    </PageShell>
  );
}
