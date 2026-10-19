import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import {
  ArrowDownToLine, BookOpen, ClipboardCheck, FileText, PackageSearch, Repeat, Trash2, type LucideIcon,
} from "lucide-react";
import { db } from "@/db";
import { products } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { DetailFrame, type DetailMode } from "@/components/detail-frame";
import {
  Badge, Callout, Card, EmptyState, KeyValue, LinkButton, NoAccess, Section, Timeline, type TimelineItem, type Tone,
} from "@/components/ui";
import { Money } from "@/components/money";
import { DIRECTION, VarianceSplit, directionOf, formatWeek } from "@/components/inventory-ui";
import { itemHistory, type ItemHistoryRow } from "@/services/inventory.service";
import { itemMovements, itemUsage, type ItemMovement } from "@/services/inventory-item.service";
import { OPENING_SOURCE_LABEL } from "@/lib/inventory/engine";
import { formatQuantity, formatSignedQuantity, milliToDecimal } from "@/lib/inventory/units";
import { formatBp } from "@/lib/inventory/equation";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { formatDay } from "@/lib/riyadh-time";
import { LINE, countNoun } from "@/lib/arabic";
import { T } from "@/components/i18n/t";


/** كم حدثاً يُعرَض قبل «اعرض الأقدم». */
const SHOWN = 12;

/**
 * ملفُّ الصنف — ما يُصرَف فيه، وما دخل الرفَّ منه، وكيف خرج في كلّ جرد.
 *
 * وهذا ما يفرّق **الحادثة** من **المشكلة**: صنفٌ ينقص كلَّ أسبوعٍ
 * بالقدر نفسه وصفتُه خاطئة أو جرعتُه زائدة؛ وصنفٌ نقص مرّةً بقدرٍ
 * كبير حدث فيه شيء. ولا يُرى الفرقُ بينهما في تقرير أسبوعٍ واحد
 * مهما دُقّق فيه. فالحركةُ والجردُ على خطٍّ زمنيٍّ واحد.
 */
export async function ItemView({
  params,
  mode,
}: {
  params: Promise<{ id: string }>;
  mode: DetailMode;
}) {
  const { id } = await params;
  const fullHref = `/inventory/items/${id}`;
  const user = await currentUser();
  if (!user) redirect(`/login?from=/inventory/items/${id}`);
  if (!can(user.role, "inventory:view")) {
    return (
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="صفحة الصنف">
        <NoAccess what="الجرد" />
      </DetailFrame>
    );
  }

  const [product] = await db
    .select({
      id: products.id, nameAr: products.nameAr, nameEn: products.nameEn, category: products.category,
      baseUnit: products.baseUnit, catalogPackUnit: products.catalogPackUnit, isActive: products.isActive,
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!product) {
    /* في اللوح يُقال الخبرُ في اللوح نفسه — صفحةُ ٤٠٤ العامّة كانت تأخذ مكانَه بلا إطاره ولا زرّ إغلاقه */
    if (mode !== "drawer") notFound();
    return (
      <DetailFrame mode={mode} fullHref={fullHref} user={user} width="page" title="صنف غير موجود">
        <EmptyState
          icon={PackageSearch}
          title="هذا الصنف غير موجود."
          hint="ربما دُمج في صنف آخر أو حُذف من الكتالوج، وستجد ذلك في سجل التدقيق."
          action={<LinkButton href="/inventory" variant="primary">الجرد</LinkButton>}
        />
      </DetailFrame>
    );
  }

  const showAmounts = can(user.role, "amounts:view");
  const [history, movements, usage] = await Promise.all([
    itemHistory(id, 12),
    itemMovements(id),
    itemUsage(id),
  ]);
  const finalised = history.filter((h) => h.status === "FINALISED" && h.varianceMilli !== null);

  const negatives = finalised.filter((h) => (h.varianceMilli ?? 0) < 0).length;
  const positives = finalised.filter((h) => (h.varianceMilli ?? 0) > 0).length;
  /* النقصُ والزيادةُ لا يتقاصّان — لا في الجرد ولا في سجلّ الصنف */
  const shortageCost = finalised.reduce((s, h) => s + Math.max(0, -(h.varianceCostMinor ?? 0)), 0);
  const overageCost = finalised.reduce((s, h) => s + Math.max(0, h.varianceCostMinor ?? 0), 0);
  const recurring = finalised.length >= 3 && negatives === finalised.length;

  const unit = product.baseUnit as StoredUnit;
  const purchases = movements.filter((m) => m.kind === "INVOICE");

  /* ── خطٌّ زمنيٌّ واحد: الجرداتُ والحركةُ معاً، الأحدثُ أوّلاً ── */
  type Dated = { day: string; item: TimelineItem };
  const dated: Dated[] = [
    ...history.map((h): Dated => ({ day: h.periodEnd, item: countItem(h, showAmounts) })),
    ...movements.map((m): Dated => ({ day: m.day, item: movementItem(m, showAmounts) })),
  ].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

  return (
    <DetailFrame
      mode={mode}
      fullHref={fullHref}
      user={user}
      width="page"
      eyebrow={`صنف مخزون · ${CATEGORY_LABEL[product.category as ProductCategory] ?? product.category}`}
      title={product.nameAr}
      intro={`يُعدّ بوحدة ${storedUnitLabel(unit)}${usage.length > 0 ? ` · يُستخدم في ${usage.length === 1 ? "صنف واحد" : usage.length === 2 ? "صنفين" : `${usage.length} أصناف`} من القائمة` : " · لا توجد وصفة تستخدمه"}.`}
    >
      {!product.isActive && (
        <Callout tone="muted" className="mb-6" title="هذا الصنف مستبعد من الجرد">
          لن يظهر في العدّ القادم، وتبقى أرقامه السابقة كما حُسبت.
        </Callout>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-10 @4xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-10">
          {/* ── الفرقُ عبر الجرودات: جهتان لا صافٍ ── */}
          <Section title="الفرق في الجردات المقفلة" className="mt-0!" hint={finalised.length > 0 ? `حُسب فرقه في آخر ${finalised.length === 1 ? "جرد واحد" : finalised.length === 2 ? "جردين" : `${finalised.length} جردات`}.` : undefined}>
            {finalised.length === 0 ? (
              <EmptyState
                compact
                icon={ClipboardCheck}
                title="لم يُحسب له فرق في أي جرد مقفل بعد."
                hint={usage.length === 0
                  ? "ولا توجد وصفة تستخدمه، فلن يُحسب له استهلاك ولا فرق حتى تضيفه إلى وصفة."
                  : "يظهر هنا بعد أن يُعدّ في جرد ويُقفل ذلك الجرد، ويُعرض النقص والزيادة كلٌّ على حدة."}
              />
            ) : (
              <>
                <VarianceSplit
                  shortage={shortageCost}
                  overage={overageCost}
                  linesShort={negatives}
                  linesOver={positives}
                  showAmounts={showAmounts}
                  measured
                />
                {recurring && (
                  <Callout tone="warn" icon={Repeat} className="mt-3" title="نقص في كل جرد">
                    النقص الذي يتكرر بالقدر نفسه يدل غالباً على خلل في الوصفة أو الكمية المصروفة أو الميزان، لا على هدر متكرر. راجع كمية الوصفة قبل أن تبحث عن هدر.
                  </Callout>
                )}
              </>
            )}
          </Section>

          <Section title="الحركة والجرد" className="mt-0!" hint="ما دخل الرف وما خرج منه بغير البيع، وكل جرد مع معادلته، والأحدث أولاً.">
            {dated.length === 0 ? (
              <EmptyState
                compact
                icon={FileText}
                title="لا توجد حركة مسجّلة لهذا الصنف بعد."
                hint="هنا تظهر فواتير شرائه، والكميات المستلمة يدوياً، والهدر المسجّل، وكل جرد دخل فيه."
              />
            ) : (
              <Card>
                <Timeline items={dated.slice(0, SHOWN).map((d) => d.item)} />
                {/* الأقدمُ خلف كشفٍ — القائمةُ الطويلة تدفن آخرَ جرد تحت أربعين فاتورة */}
                {dated.length > SHOWN && (
                  <details className="group mt-5 border-t border-line-soft pt-4">
                    <summary className="flex min-h-11 cursor-pointer items-center text-xs font-bold text-accent hover:underline sm:min-h-8">
                      <T s="اعرض الأقدم ({0})" a={[dated.length - SHOWN]} /></summary>
                    <div className="mt-4">
                      <Timeline items={dated.slice(SHOWN).map((d) => d.item)} />
                    </div>
                  </details>
                )}
              </Card>
            )}
          </Section>
        </div>

        <aside className="order-first min-w-0 space-y-6 @4xl:order-none">
          <Card>
            <KeyValue
              columns={2}
              items={[
                { label: "وحدة العدّ", value: storedUnitLabel(unit) },
                { label: "التصنيف", value: CATEGORY_LABEL[product.category as ProductCategory] ?? product.category },
                { label: "عبوة الكتالوج", value: product.catalogPackUnit ?? <span className="text-muted">غير معروفة</span> },
                {
                  label: "الشراء",
                  value: purchases.length === 0
                    ? <span className="text-muted">لا يوجد بند فاتورة مربوط</span>
                    : <><T s="{0}{1} في الفواتير" a={[countNoun(purchases.length, LINE), purchases.length >= 40 ? " أو أكثر" : ""]} /></>,
                  hint: purchases[0] ? `آخر شراء ${formatDay(purchases[0].day)}` : undefined,
                },
                { label: "مرات العدّ", value: history.filter((h) => h.actualMilli !== null).length === 0 ? <span className="text-muted">لم يُعدّ بعد</span> : <span className="nums">{history.filter((h) => h.actualMilli !== null).length}</span> },
              ]}
            />
          </Card>

          <Section title="يُستخدم في" icon={BookOpen} className="mt-0!" count={usage.length > 0 ? usage.length : undefined}>
            {usage.length === 0 ? (
              <Callout tone="warn" icon={BookOpen} title="لا توجد وصفة تستخدمه">
                <T s="بدون وصفة لا يُحسب له استهلاك متوقع، فيظهر كل ما اشتريته منه «فرقاً».{0}" a={[can(user.role, "recipe:edit") && (
                  <> <Link href="/inventory/recipes" className="font-bold text-accent hover:underline">افتح الوصفات</Link>.</>
                )]} /></Callout>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {usage.map((u) => (
                  <li key={u.menuProductId}>
                    <Badge>{u.name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <p className="rounded-xl border border-line bg-sunken/60 px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
            الفرق الذي يتكرر بالقدر نفسه يدل غالباً على خلل في الوصفة أو الكمية المصروفة أو الميزان. أما الفرق المتقلب فيدل على عدّ مستعجل أو فاتورة وصلت متأخرة. وما تعرف سببه سجّله هدراً في الجرد نفسه، فيخرج من «الفرق غير المفسَّر».
          </p>
        </aside>
      </div>
    </DetailFrame>
  );
}

/** جردٌ في الخطّ الزمنيّ — بمعادلته كلِّها ومصدرِ كلّ حدّ. */
function countItem(h: ItemHistoryRow, showAmounts: boolean): TimelineItem {
  const d = directionOf(h.varianceMilli);
  const tone: Tone = !h.inScope ? "muted" : d ? DIRECTION[d].tone : "muted";
  return {
    id: `count:${h.countId}`,
    icon: ClipboardCheck,
    tone,
    href: `/inventory/counts/${h.countId}`,
    title: (
      <>
        <T s="جرد أسبوع {0}{1}{2}" a={[formatWeek(h.periodStart, h.periodEnd), h.status === "DRAFT" && <span className="ms-2 align-middle"><Badge tone="accent">مسودة</Badge></span>, !h.inScope && <span className="ms-2 align-middle"><Badge>خارج الجرد</Badge></span>]} /></>
    ),
    meta: h.varianceMilli === null ? "لم يُحسب فرق" : (
      <span className={`font-bold ${d ? DIRECTION[d].text : ""}`}>
        <span className="nums">{formatSignedQuantity(h.varianceMilli, h.baseUnit)}</span>
        <span className="font-normal text-muted"> · <span className="nums">{formatBp(h.varianceConsumptionBp)}</span></span>
        {showAmounts && h.varianceCostMinor !== null && <span className="font-normal text-muted"> · <Money minor={Math.abs(h.varianceCostMinor)} /></span>}
      </span>
    ),
    /*
      المعادلةُ كلُّها بمصادرها — فيُقرأ **المتكرّر**: نقصٌ بنسبةٍ متقاربة
      كلَّ أسبوع يشير إلى وصفةٍ أو جرعة، ونقصٌ مرّةً وزيادةٌ مرّة يشير إلى
      عدٍّ أو توقيتِ استلام.
    */
    body: (
      <span className="nums">
        <T s="الافتتاحي {0}{1} + المشتريات {2}{3} − الاستهلاك {4}{5} = المتوقع {6} · الفعلي {7}" a={[formatQuantity(h.openingMilli, h.baseUnit), h.openingMilli !== null && ` (${OPENING_SOURCE_LABEL[h.openingSource]})`, formatQuantity(h.purchasesMilli, h.baseUnit), h.manualReceiptsMilli > 0 && ` (منها ${formatQuantity(h.manualReceiptsMilli, h.baseUnit)} يدوياً)`, formatQuantity(h.theoreticalConsumptionMilli, h.baseUnit), h.recordedWasteMilli > 0 && <><T s=" − هدر {0}" a={[formatQuantity(h.recordedWasteMilli, h.baseUnit)]} /></>, formatQuantity(h.theoreticalClosingMilli, h.baseUnit), formatQuantity(h.actualMilli, h.baseUnit)]} /></span>
    ),
  };
}

const MOVEMENT_SKIN: Record<ItemMovement["kind"], { icon: LucideIcon; tone: Tone }> = {
  INVOICE: { icon: FileText, tone: "info" },
  RECEIPT: { icon: ArrowDownToLine, tone: "ok" },
  WASTE: { icon: Trash2, tone: "warn" },
  ADJUSTMENT: { icon: Repeat, tone: "muted" },
};

/** حركةٌ في الخطّ الزمنيّ — بكمّيّتها كما أُدخلت، ولا تحويلَ هنا. */
function movementItem(m: ItemMovement, showAmounts: boolean): TimelineItem {
  const skin = MOVEMENT_SKIN[m.kind];
  const qty = m.invoiceQty !== null
    ? `${trimDecimal(m.invoiceQty)} ×`
    : m.milli !== null && m.unit ? `${trimDecimal(milliToDecimal(m.milli))} ${storedUnitLabel(m.unit)}` : null;
  return {
    id: m.id,
    icon: skin.icon,
    tone: m.voided ? "muted" : skin.tone,
    /* الفاتورةُ مالٌ — ومن لا يرى المبالغ يقرأ السطرَ ولا يُرسَل إلى «خارج صلاحيتك» */
    href: m.kind === "INVOICE" && !showAmounts ? undefined : m.href ?? undefined,
    title: <span className={m.voided ? "line-through decoration-muted" : ""}>{m.title}</span>,
    meta: formatDay(m.day),
    body: (
      <span>
        {qty && <span className="nums font-bold text-ink">{qty}</span>}
        {m.detail && <span dir="auto"> {m.detail}</span>}
        {showAmounts && m.amountMinor !== null && <span className="text-muted"> · <Money minor={m.amountMinor} /></span>}
      </span>
    ),
  };
}

/** «3.000» ← «3» — الأصفارُ الزائدة لا تقول شيئاً. */
function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
