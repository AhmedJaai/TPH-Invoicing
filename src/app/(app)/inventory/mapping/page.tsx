import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { BookOpen, CircleCheck, Link2, TriangleAlert } from "lucide-react";
import { Callout, EmptyState, LinkButton, NoAccess, Section } from "@/components/ui";
import { loadInventorySetup } from "@/services/inventory-overview.service";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { PosProductMapping } from "@/components/pos-product-mapping";
import { unmappedPosProducts } from "@/services/inventory.service";

export const dynamic = "force-dynamic";

/**
 * «منتجات تحتاج ربطاً».
 *
 * ويُربَط الصنفُ **مرّةً واحدة** فيُتذكَّر: الربطُ على معرّفه عند فودكس
 * لا على اسمه، فتغيُّرُ الاسم في القائمة لا يُبطله. والدرسُ من طابور
 * البنك: ثلاثٌ وأربعون حركةً أكّدها أحمد بيده كانت تعود إليه كلَّ مرّة
 * لأنّ الشرط كان يقرأ عموداً آخر.
 */
export default async function PosMappingPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/mapping");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="page" title="منتجات تحتاج ربطاً">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const [rows, menuProducts, setup] = await Promise.all([
    unmappedPosProducts(),
    db.select({ id: products.id, nameAr: products.nameAr })
      .from(products)
      .where(and(eq(products.isActive, true), eq(products.isMenuItem, true)))
      .orderBy(asc(products.nameAr)),
    loadInventorySetup(),
  ]);

  return (
    <PageShell
      user={user}
      width="page"
      title="منتجات تحتاج ربطاً"
      intro="اربط كل منتج مرة واحدة ليتعرّف عليه النظام في كل استيراد لاحق. يعتمد الربط على رقم المنتج في فودكس وليس على اسمه."
      actions={can(user.role, "recipe:edit") ? <LinkButton href="/inventory/recipes" size="sm" icon={BookOpen}>الوصفات</LinkButton> : undefined}
    >
      {rows.length === 0 ? (
        setup.sales === 0 ? (
          <EmptyState
            icon={Link2}
            title="لا توجد مبيعات مستوردة بعد."
            hint="يظهر هنا كل منتج بِيع في فودكس وليس له صنف مقابل عندنا، مرتّباً حسب الأكثر مبيعاً. وإذا رفعت الكتالوج قبل المبيعات فلن تحتاج إلى ربط شيء تقريباً."
            action={<LinkButton href="/inventory/import#sales" variant="primary" size="sm">ارفع ملفّ المبيعات</LinkButton>}
          />
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-5 py-6">
            <CircleCheck className="h-6 w-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
            <div>
              <p className="text-sm font-bold text-ok">كل ما بِيع مربوط بصنف عندنا.</p>
              <p className="mt-0.5 text-xs text-ink-soft">لا يكفي الربط وحده، فكل صنف يحتاج أيضاً إلى وصفة سارية ليُحسب استهلاكه.</p>
            </div>
          </div>
        )
      ) : (
        <>
          <Callout tone="warn" icon={TriangleAlert} className="mb-6" title={`منتجات بلا صنف مقابل: ${countNoun(rows.length, PRODUCT)}`}>
            المنتج غير المربوط لا يدخل في حساب الاستهلاك، ويظهر في تقرير كل جرد مع نسبته من المبيعات. ولا يكفي الربط وحده، فالصنف يحتاج بعده إلى وصفة سارية.
          </Callout>
          <Section title="غير المربوط" className="mt-0!" hint="مرتّب حسب المبيعات، فالأكثر مبيعاً أكبر أثراً في الحساب.">
            <PosProductMapping
              rows={rows}
              menuProducts={menuProducts.map((p) => ({ id: p.id, name: p.nameAr }))}
              canEdit={can(user.role, "recipe:edit")}
            />
          </Section>
        </>
      )}
    </PageShell>
  );
}
