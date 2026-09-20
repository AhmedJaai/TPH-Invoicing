import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Card, NoAccess, Section, buttonClass } from "@/components/ui";
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

  const rows = await unmappedPosProducts();
  const menuProducts = await db
    .select({ id: products.id, nameAr: products.nameAr })
    .from(products)
    .where(and(eq(products.isActive, true), eq(products.isMenuItem, true)))
    .orderBy(asc(products.nameAr));

  return (
    <PageShell
      user={user}
      width="page"
      title="منتجات تحتاج ربطاً"
      intro="اربطه مرّةً فيُعرَف في كلّ استيرادٍ بعده — الربطُ على معرّفه عند فودكس لا على اسمه."
      actions={<Link href="/inventory/recipes" className={buttonClass("secondary", "sm")}>الوصفات</Link>}
    >
      {rows.length > 0 && (
        <Card tone="warn">
          <p className="text-xs leading-relaxed">
            ما لم يُربَط لا يدخل حسابَ الاستهلاك، ويُعلَن في تقرير كلّ جردٍ بنسبة ما
            يمثّله من المبيعات. والربطُ وحده لا يكفي: يحتاج الصنفُ بعده وصفةً سارية.
          </p>
        </Card>
      )}

      <Section title="غيرُ المربوط" hint="مرتَّبٌ بما بِيع منه — فالأكثرُ مبيعاً أثقلُ في الحساب.">
        <PosProductMapping
          rows={rows}
          menuProducts={menuProducts.map((p) => ({ id: p.id, name: p.nameAr }))}
          canEdit={can(user.role, "recipe:edit")}
        />
      </Section>
    </PageShell>
  );
}
