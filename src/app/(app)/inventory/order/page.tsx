import { redirect } from "next/navigation";
import { ClipboardList, PackageCheck } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { EmptyState, LinkButton, LinkTabs, NoAccess } from "@/components/ui";
import { OrderList } from "@/components/order-list";
import { DAY, PRODUCT, SUPPLIER, countNoun, countNounGen } from "@/lib/arabic";
import { ORDER_COVER_DAYS, ORDER_HORIZONS, ORDER_LEAD_DAYS } from "@/lib/inventory/order-list";
import { formatDay } from "@/lib/riyadh-time";
import { loadOrderList } from "@/services/order-list.service";

export const dynamic = "force-dynamic";

const HORIZON_LABEL: Record<(typeof ORDER_HORIZONS)[number], string> = { 7: "ينفد خلال أسبوع", 14: "ينفد خلال أسبوعين" };

/**
 * قائمة الطلب — ما ينفد قريباً، مجموعاً بمورّده، بكمّيّةٍ مقترحة تُعدَّل ورسالةٍ تُنسخ.
 * قراءةٌ فقط: الكمّيّاتُ المعدَّلة في المتصفّح وحده، ولا يُرسَل شيء (`lib/inventory/order-list.ts`).
 */
export default async function OrderListPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/order");
  if (!can(user.role, "inventory:view")) {
    return <PageShell user={user} title="قائمة الطلب"><NoAccess what="قائمة الطلب" /></PageShell>;
  }
  const q = await searchParams;
  const horizon = ORDER_HORIZONS.find((d) => String(d) === q.days) ?? ORDER_HORIZONS[0];
  const view = await loadOrderList({ horizonDays: horizon });
  const lines = view.groups.reduce((s, g) => s + g.lines.length, 0);
  const known = view.groups.filter((g) => g.supplierId !== null).length;

  return (
    <PageShell
      user={user}
      title="قائمة الطلب"
      eyebrow={view.countDay ? <>من جرد <bdi>{formatDay(view.countDay)}</bdi></> : undefined}
      intro={`ما قد ينفد قريباً، مجموعاً حسب المورد الذي اشتريته منه آخر مرة. الكمية المقترحة تكفي ${countNounGen(ORDER_LEAD_DAYS, DAY)} للتوصيل ثم ${countNounGen(ORDER_COVER_DAYS, DAY)}، مقرّبة إلى العبوة الكاملة. عدّلها ثم انسخ الرسالة.`}
    >
      <LinkTabs
        label="المدة"
        items={ORDER_HORIZONS.map((d) => ({ href: d === ORDER_HORIZONS[0] ? "/inventory/order" : `/inventory/order?days=${d}`, label: HORIZON_LABEL[d], active: d === horizon }))}
      />

      {view.countDay === null ? (
        <div className="mt-5">
          <EmptyState
            icon={ClipboardList}
            title="لم يُعدّ الرف بعد، فلا يُعرف ما ينفد."
            hint="تُبنى القائمة على آخر جرد: المعدود، وما اشتُري بعده، وما صرفته الوصفات. ابدأ جرد الأسبوع، أو أدخل جرد فودكس."
            action={can(user.role, "inventory:count") ? <LinkButton href="/inventory" size="sm" variant="primary">ابدأ الجرد</LinkButton> : undefined}
          />
        </div>
      ) : lines === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={PackageCheck}
            title={`لا شيء ${HORIZON_LABEL[horizon]}.`}
            hint={`قيس ${countNoun(view.measured, PRODUCT)} من جرد ${formatDay(view.countDay)} ومتوسط صرف آخر أربعة أسابيع. ما لم يُعدّ أو لا وصفة له لا يدخل القائمة.`}
            action={horizon === ORDER_HORIZONS[0] ? <LinkButton href="/inventory/order?days=14" size="sm">انظر ما ينفد خلال أسبوعين</LinkButton> : undefined}
          />
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-ink-soft">
            {`${countNoun(lines, PRODUCT)} ${known > 0 ? `عند ${countNounGen(known, SUPPLIER)}` : ""}${view.groups.some((g) => g.supplierId === null) ? "، وبعضها بلا مورد معروف" : ""}. تقدير من آخر جرد؛ وفاتورة لم تُربط بصنفها تجعله يبدو أقل مما على الرف.`}
          </p>
          <OrderList groups={view.groups} showMoney={can(user.role, "amounts:view")} />
        </>
      )}
    </PageShell>
  );
}
