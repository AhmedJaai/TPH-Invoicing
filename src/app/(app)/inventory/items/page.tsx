import { redirect } from "next/navigation";
import Link from "next/link";
import { sql } from "drizzle-orm";
import { BookOpen, Package } from "lucide-react";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, Callout, DataTable, EmptyState, LinkButton, LinkTabs, NoAccess, type Column } from "@/components/ui";
import { Money } from "@/components/money";
import { isStoredUnit, storedUnitLabel } from "@/lib/unit-conversion";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { formatBp } from "@/lib/inventory/equation";
import { RetireItem } from "@/components/retire-item";
import { DirectionTag, RECIPE } from "@/components/inventory-ui";
import { PRODUCT, TIME, countNoun } from "@/lib/arabic";

export const dynamic = "force-dynamic";

interface ItemRow {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  unitLabel: string;
  inRecipes: number;
  lastVarianceMilli: number | null;
  lastVarianceBp: number | null;
  lastVarianceCostMinor: number | null;
  countedTimes: number;
}

type Show = "all" | "norecipe" | "uncounted";

/**
 * الأصناف — ما يُعَدّ على الرفّ.
 *
 * والعمودُ الذي يستحقّ النظر «في كم وصفة»: صنفٌ في صفر وصفات لا
 * يُحسَب له استهلاكٌ متوقَّع أبداً، فيظهر فرقُه كلَّ أسبوعٍ بحجم ما
 * اشتُري منه — وهو ليس فرقاً بل غيابَ وصفة. فله لسانُه في الترشيح.
 */
export default async function InventoryItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/items");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="wide" title="الأصناف">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }
  const { show: showParam } = await searchParams;
  const show: Show = showParam === "norecipe" || showParam === "uncounted" ? showParam : "all";

  const rows = await db.execute<Record<string, unknown>>(sql`
    select p.id, p.name_ar, p.category, p.base_unit,
           (select count(distinct ri.recipe_version_id)::int
              from recipe_ingredients ri
              join recipe_versions rv on rv.id = ri.recipe_version_id
             where ri.product_id = p.id and rv.status = 'ACTIVE') as in_recipes,
           (select count(*)::int from inventory_count_lines l
             where l.product_id = p.id and l.actual_milli is not null) as counted_times,
           last.variance_milli as last_milli,
           last.variance_bp as last_bp,
           last.variance_cost_minor as last_cost
      from products p
      left join lateral (
        select l.variance_milli, l.variance_bp, l.variance_cost_minor
          from inventory_count_lines l
          join inventory_counts c on c.id = l.count_id
         where l.product_id = p.id and c.status = 'FINALISED'
         order by c.period_end desc
         limit 1
      ) last on true
     where p.is_active and p.is_stock_item
     order by p.category, p.name_ar
  `);

  const all: ItemRow[] = rows.rows.map((r) => {
    const unit = isStoredUnit(r.base_unit) ? r.base_unit : "PIECE";
    const category = String(r.category);
    return {
      id: String(r.id),
      name: String(r.name_ar),
      category,
      categoryLabel: CATEGORY_LABEL[category as ProductCategory] ?? category,
      unitLabel: storedUnitLabel(unit),
      inRecipes: Number(r.in_recipes ?? 0),
      countedTimes: Number(r.counted_times ?? 0),
      lastVarianceMilli: r.last_milli === null || r.last_milli === undefined ? null : Number(r.last_milli),
      lastVarianceBp: r.last_bp === null || r.last_bp === undefined ? null : Number(r.last_bp),
      lastVarianceCostMinor: r.last_cost === null || r.last_cost === undefined ? null : Number(r.last_cost),
    };
  });

  const noRecipe = all.filter((r) => r.inRecipes === 0);
  const uncounted = all.filter((r) => r.countedTimes === 0);
  const items = show === "norecipe" ? noRecipe : show === "uncounted" ? uncounted : all;

  /* من لا يرى المبالغ لا يُعرَض له عمودُ الكلفة — و`inventory:view` ليست `amounts:view` */
  const showAmounts = can(user.role, "amounts:view");
  const canEdit = can(user.role, "recipe:edit");

  let columns: readonly Column<ItemRow>[] = [
    {
      key: "name", header: "الصنف", primary: true,
      cell: (r) => (
        <span className="block min-w-0">
          <Link href={`/inventory/items/${r.id}`} className="font-bold hover:text-accent" dir="auto">{r.name}</Link>
          <span className="mt-0.5 block text-[11px] font-normal text-muted">{r.categoryLabel} · يُعَدّ بـ{r.unitLabel}</span>
        </span>
      ),
    },
    {
      key: "recipes", header: "في الوصفات",
      cell: (r) => (
        r.inRecipes === 0
          ? <Badge tone="warn" dot>لا وصفةَ تصل إليه</Badge>
          : <span className="text-ink-soft">{countNoun(r.inRecipes, RECIPE)}</span>
      ),
    },
    {
      key: "last", header: "آخرُ فرق",
      cell: (r) => (
        r.lastVarianceBp === null && r.lastVarianceMilli === null
          ? <span className="text-muted">{r.countedTimes === 0 ? "لم يُعَدّ بعد" : "لم يُحسَب"}</span>
          : (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <DirectionTag milli={r.lastVarianceMilli} />
              <span className="nums text-muted">{formatBp(r.lastVarianceBp)}</span>
              {showAmounts && r.lastVarianceCostMinor !== null && <Money minor={Math.abs(r.lastVarianceCostMinor)} />}
            </span>
          )
      ),
    },
    {
      key: "times", header: "العدّ", secondary: true,
      cell: (r) => r.countedTimes === 0 ? <span className="text-muted">لم يُعَدّ بعد</span> : <span className="text-ink-soft">{countNoun(r.countedTimes, TIME)}</span>,
    },
  ];

  /*
    ── ولِمَ الفعلُ هنا لا في صفحة الصنف ──

    من يراجع كتالوجاً مستورَداً يخرج منه عشرةَ أصنافٍ لا يشتريها —
    وذلك عشرُ صفحاتٍ تُفتَح وتُغلَق لو كان الفعلُ في صفحة الصنف.
  */
  if (canEdit) {
    columns = [...columns, {
      key: "retire", header: "", wrap: true, align: "end",
      cell: (r) => <RetireItem productId={r.id} name={r.name} />,
    }];
  }

  return (
    <PageShell
      user={user}
      width="wide"
      title="الأصناف"
      intro="ما يُعَدّ على الرفّ ووحدةُ قياسه. وصنفٌ لا وصفةَ تصل إليه لا يُحسَب له استهلاكٌ متوقَّع — فيظهر ما اشتُري منه كلُّه فرقاً."
    >
      {all.length > 0 && noRecipe.length === all.length && (
        <Callout
          tone="warn"
          icon={BookOpen}
          className="mb-6"
          title="لا صنفَ هنا تصل إليه وصفة بعد"
          action={canEdit ? <LinkButton href="/inventory/import#catalog" variant="primary" size="sm">ارفع كتالوج فودكس</LinkButton> : undefined}
        >
          هذه أصنافٌ أنشأتها فواتيرُ المورّدين. وبلا وصفاتٍ لا يُعرَف ما صُرف منها — والكتالوجُ يُنشئ الوصفاتِ كلَّها دفعةً واحدة.
        </Callout>
      )}

      {all.length > 0 && (
        <div className="mb-4">
          <LinkTabs
            label="رشِّح الأصناف"
            items={[
              { href: "/inventory/items", label: "الكلّ", count: all.length, active: show === "all" },
              { href: "/inventory/items?show=norecipe", label: "بلا وصفة", count: noRecipe.length, active: show === "norecipe" },
              { href: "/inventory/items?show=uncounted", label: "لم يُعَدّ بعد", count: uncounted.length, active: show === "uncounted" },
            ]}
          />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={items}
        keyOf={(r) => r.id}
        hrefOf={(r) => `/inventory/items/${r.id}`}
        searchOf={(r) => `${r.name} ${r.categoryLabel} ${r.unitLabel}`}
        searchLabel="ابحث باسم الصنف أو بابه"
        empty={
          all.length === 0 ? (
            <EmptyState
              icon={Package}
              title="لا صنفَ مخزونٍ مسجَّل بعد."
              hint="كتالوجُ فودكس يُنشئ أصنافَ المخزون ووصفاتِها دفعةً واحدة. وتُبنى أصنافٌ كذلك من بنود فواتير المورّدين حين تُربَط."
              action={canEdit ? <LinkButton href="/inventory/import#catalog" variant="primary" size="sm">ارفع كتالوج فودكس</LinkButton> : undefined}
            />
          ) : (
            <EmptyState
              compact
              icon={Package}
              title={show === "norecipe" ? "كلُّ صنفٍ تصل إليه وصفة." : "عُدّ كلُّ صنفٍ مرّةً على الأقلّ."}
              hint={`والأصنافُ كلُّها ${countNoun(all.length, PRODUCT)} في لسان «الكلّ».`}
            />
          )
        }
      />
    </PageShell>
  );
}
