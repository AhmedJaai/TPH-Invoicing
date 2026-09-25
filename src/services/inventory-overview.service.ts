import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * ما يعرفه الجرد الآن — قراءةٌ واحدة تُجيب «أين أنا من الطريق؟».
 *
 * الجردُ يقوم على ثلاثةٍ بترتيبها: كتالوجٌ يُنشئ الأصنافَ والوصفات، ثمّ
 * مبيعاتٌ من ملفّ فودكس الحقيقيّ تقول ما صُرف، ثمّ عدٌّ يُقابلهما. وكلُّ
 * شاشةٍ في المساحة تسأل السؤالَ نفسه، فيُسأل هنا مرّةً ولا يُنسَخ في
 * صفحة — وإلّا قالت «الاستيراد» خطوةً وقالت «الجرد الحالي» غيرها.
 *
 * قراءةٌ لا كتابة، والأعدادُ أعدادٌ لا مبالغ: لا يُحسَب هنا فرقٌ ولا كلفة.
 */
export interface InventorySetup {
  /** أصنافُ مخزونٍ فعّالة — ما يُعَدّ على الرفّ. */
  stockItems: number;
  /** أصنافٌ مباعة في القائمة. */
  menuItems: number;
  recipes: number;
  /** بيعاتٌ مقيَّدة من ملفّات فودكس — لا تُملأ بغيرها أبداً. */
  sales: number;
  /** آخرُ يوم عملٍ في المبيعات المستورَدة — «غير معروف» إن لم تصل. */
  salesThrough: string | null;
  salesFrom: string | null;
  /** ما بِيع ولا صنفَ له عندنا — يُربَط مرّةً ثمّ يُعرَف. */
  unmapped: number;
  counts: number;
  finalised: number;
  /** جردٌ مفتوح إن وُجد — فهو ما يُعمَل فيه. */
  openCountId: string | null;
  lastImport: { fileName: string; status: string; createdAt: Date; periodEnd: string | null } | null;
}

export type SetupStepId = "catalog" | "sales" | "count";

export async function loadInventorySetup(): Promise<InventorySetup> {
  const [r] = (await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from products where is_stock_item and is_active) as stock_items,
      (select count(*)::int from products where is_menu_item and is_active)  as menu_items,
      (select count(*)::int from recipes)                                     as recipes,
      (select count(*)::int from sales where not is_void)                     as sales,
      (select max(business_date) from sales where not is_void)                as sales_through,
      (select min(business_date) from sales where not is_void)                as sales_from,
      (select count(*)::int from pos_products pp
        where pp.product_id is null and pp.kind = 'PRODUCT')                  as unmapped,
      (select count(*)::int from inventory_counts)                            as counts,
      (select count(*)::int from inventory_counts where status = 'FINALISED') as finalised,
      (select id from inventory_counts where status = 'DRAFT'
        order by period_end desc limit 1)                                     as open_count_id
  `)).rows;

  const [imp] = (await db.execute<Record<string, unknown>>(sql`
    select file_name, status, created_at, period_end
      from sales_imports
     order by created_at desc
     limit 1
  `)).rows;

  return {
    stockItems: Number(r?.stock_items ?? 0),
    menuItems: Number(r?.menu_items ?? 0),
    recipes: Number(r?.recipes ?? 0),
    sales: Number(r?.sales ?? 0),
    salesThrough: r?.sales_through ? String(r.sales_through) : null,
    salesFrom: r?.sales_from ? String(r.sales_from) : null,
    unmapped: Number(r?.unmapped ?? 0),
    counts: Number(r?.counts ?? 0),
    finalised: Number(r?.finalised ?? 0),
    openCountId: r?.open_count_id ? String(r.open_count_id) : null,
    lastImport: imp
      ? {
          fileName: String(imp.file_name),
          status: String(imp.status),
          createdAt: new Date(String(imp.created_at)),
          periodEnd: imp.period_end ? String(imp.period_end) : null,
        }
      : null,
  };
}

/**
 * الخطوةُ التالية — واحدةٌ لا ثلاث.
 *
 * كتالوجٌ بلا وصفة يجعل الاستهلاكَ مجهولاً كلَّه، ومبيعاتٌ بلا كتالوج
 * لا تُحسَب؛ فالترتيبُ ليس ذوقاً. و«تمّ» تُقال بدليلها: وصفةٌ واحدة على
 * الأقلّ، وبيعةٌ واحدة على الأقلّ، وجردٌ واحد بدأ.
 */
export function setupProgress(s: InventorySetup): {
  done: Record<SetupStepId, boolean>;
  next: SetupStepId | null;
  complete: boolean;
} {
  const done = {
    catalog: s.recipes > 0,
    sales: s.sales > 0,
    count: s.counts > 0,
  };
  const next: SetupStepId | null = !done.catalog ? "catalog" : !done.sales ? "sales" : !done.count ? "count" : null;
  return { done, next, complete: done.catalog && done.sales };
}
