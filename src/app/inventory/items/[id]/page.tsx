import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, Card, EmptyState, NoAccess, Section, Stat, StatGrid } from "@/components/ui";
import { Money } from "@/components/money";
import { itemHistory } from "@/services/inventory.service";
import { formatQuantity, formatSignedQuantity } from "@/lib/inventory/units";
import { formatBp } from "@/lib/inventory/equation";
import { storedUnitLabel } from "@/lib/unit-conversion";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";

export const dynamic = "force-dynamic";

/**
 * تاريخُ الجرد لصنفٍ واحد.
 *
 * وهذا ما يفرّق **الحادثة** من **المشكلة**: صنفٌ ينقص كلَّ أسبوعٍ
 * بالقدر نفسه وصفتُه خاطئة أو جرعتُه زائدة؛ وصنفٌ نقص مرّةً بقدرٍ
 * كبير حدث فيه شيء. ولا يُرى الفرقُ بينهما في تقرير أسبوعٍ واحد
 * مهما دُقّق فيه.
 */
export default async function ItemHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?from=/inventory/items/${id}`);
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="page" title="تاريخ الجرد">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const [product] = await db
    .select({ id: products.id, nameAr: products.nameAr, category: products.category, baseUnit: products.baseUnit })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!product) notFound();

  const history = await itemHistory(id, 12);
  const finalised = history.filter((h) => h.status === "FINALISED" && h.varianceMilli !== null);

  const negatives = finalised.filter((h) => (h.varianceMilli ?? 0) < 0).length;
  const totalCost = finalised.reduce((s, h) => s + (h.varianceCostMinor ?? 0), 0);

  return (
    <PageShell
      user={user}
      width="page"
      title="تاريخ الجرد"
      intro={`${product.nameAr} · ${CATEGORY_LABEL[product.category as ProductCategory] ?? product.category} · يُقاس بـ${storedUnitLabel(product.baseUnit)}`}
    >
      <StatGrid>
        <Stat label="جرداتٌ فيها فرق" value={`${finalised.length}`} />
        <Stat
          label="نقص في"
          value={`${negatives} من ${finalised.length}`}
          tone={finalised.length > 0 && negatives === finalised.length ? "danger" : undefined}
          sub={finalised.length >= 3 && negatives === finalised.length
            ? "نقصٌ في كلّ مرّة — راجِع جرعة الوصفة والميزان قبل أن تبحث عن فاقد"
            : undefined}
        />
        <Stat label="مجموعُ كلفة الفروق" minor={totalCost} tone={totalCost < 0 ? "danger" : undefined} />
        <Stat
          label="آخرُ فرق"
          value={finalised[0] ? formatSignedQuantity(finalised[0].varianceMilli, finalised[0].baseUnit) : "—"}
        />
      </StatGrid>

      <Section title="أسبوعاً أسبوعاً">
        {history.length === 0 ? (
          <EmptyState
            title="لم يدخل هذا الصنف جرداً بعد."
            hint="يظهر هنا بعد أوّل جردٍ يُدخَل له عدٌّ فعليّ."
          />
        ) : (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {history.map((h) => (
              <li key={h.countId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <Link href={`/inventory/counts/${h.countId}`} className="nums w-44 shrink-0 text-xs font-bold hover:underline">
                  {h.periodStart} → {h.periodEnd}
                </Link>
                {h.status === "DRAFT" && <Badge tone="warn">مسوّدة</Badge>}
                <span className="nums text-[11px] text-muted">
                  المتوقَّع {formatQuantity(h.theoreticalClosingMilli, h.baseUnit)}
                  {" · "}
                  الفعليّ {formatQuantity(h.actualMilli, h.baseUnit)}
                </span>
                <span className="grow" />
                <span className={`nums text-xs font-bold ${(h.varianceMilli ?? 0) < 0 ? "text-danger" : "text-ok"}`}>
                  {formatSignedQuantity(h.varianceMilli, h.baseUnit)}
                </span>
                <span className="nums w-16 text-end text-xs text-muted">{formatBp(h.varianceBp)}</span>
                <span className="nums w-24 text-end text-xs">
                  {h.varianceCostMinor === null ? "—" : <Money minor={h.varianceCostMinor} />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Card className="mt-6">
        <p className="text-[11px] leading-relaxed text-ink-soft">
          الفرقُ المتكرّر بالقدر نفسه يشير إلى الوصفة أو الجرعة أو الميزان — لا إلى
          فاقدٍ متكرّر. والفرقُ المتقلّب يشير إلى عدٍّ مستعجل أو فاتورةٍ تصل متأخّرة.
          وما تعرف سببَه سجِّله هدراً في الجرد نفسه، فيخرج من «الفرق غير المفسَّر».
        </p>
      </Card>
    </PageShell>
  );
}
