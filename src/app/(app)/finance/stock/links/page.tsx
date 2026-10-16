import { redirect } from "next/navigation";
import { ArrowRight, CircleCheck, Info, Link2, Scale } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { ApproveReady, StockLinkList } from "@/components/stock-link-list";
import { Callout, KeyFigure, LinkButton, LinkTabs, NoAccess, Section } from "@/components/ui";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { formatShare } from "@/lib/finance/format";
import { storedUnitLabel } from "@/lib/unit-conversion";
import { coverageAfterReady, isReady, loadStockLinks, notStockKey, READY_MIN_MATCHES } from "@/services/stock-link.service";

export const dynamic = "force-dynamic";

const VIEWS = ["open", "ready", "linked", "out"] as const;
type View = (typeof VIEWS)[number];
/** كم بنداً يُعرَض في المرّة — الأثقلُ قيمةً أوّلاً. */
const SHOWN = 60;

/**
 * ربطُ بنود الفواتير بأصناف المخزون — أوّلُ العمل قبل تقرير «المشترى والمباع»: بندٌ لم
 * يُربَط مشترياتُ صنفه «غير معروفة». والاقتراحُ من فودكس (المورّدُ نفسه والأيّامُ نفسها
 * والمبلغُ نفسه) ومن الاسم؛ ولا يُكتب ربطٌ إلّا بضغطة.
 */
export default async function StockLinksPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/finance/stock/links");
  if (!can(user.role, "amounts:view")) {
    return <PageShell user={user} title="ربط بنود الفواتير"><NoAccess what="ربط بنود الفواتير" /></PageShell>;
  }
  const q = await searchParams;
  const links = await loadStockLinks();
  const canEdit = can(user.role, "inventory:count") && can(user.role, "bank:edit");
  const ready = links.rows.filter(isReady);
  const open = links.rows.filter((r) => r.status !== "LINKED" && !r.notStock);
  const linked = links.rows.filter((r) => r.status === "LINKED" && !r.notStock);
  const out = links.rows.filter((r) => r.notStock);
  const view: View = VIEWS.find((v) => v === q.view) ?? (ready.length > 0 ? "ready" : "open");
  const list = view === "ready" ? ready : view === "linked" ? linked : view === "out" ? out : open;
  const coverage = coverageAfterReady(links);
  const keys = Object.fromEntries(links.rows.map((r) => [r.supplierProductId, notStockKey(r.supplierProductId)]));

  return (
    <PageShell
      user={user}
      width="wide"
      title="ربط بنود الفواتير"
      intro="اسم الصنف في الفاتورة غير اسمه في الوصفة. اربط كلّ بند بصنف المخزون وقل كم في وحدته — مرّةً واحدة، ويدخل كلّ تقرير بعدها."
      actions={<LinkButton href="/finance/stock" variant="quiet" size="sm" icon={ArrowRight}>المشترى والمباع</LinkButton>}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={Link2}
          label="مربوط من قيمة المشتريات"
          tone={(coverage.nowBp ?? 0) >= 8_000 ? "ok" : "warn"}
          value={<span className="nums">{formatShare(coverage.nowBp)}</span>}
          sub={<><Money minor={links.measuredMinor} /> من <Money minor={links.totalMinor - links.notStockMinor} /> مشتريات كلّ الوقت — بنده مربوط بصنف وعبوته معروفة. والصنف يدخل تقرير «المشترى والمباع» حين يبلغ المربوط منه أربعة أخماس ما أدخل في فودكس.</>}
        />
        <KeyFigure
          icon={Scale}
          label="جاهز بدليل فودكس"
          value={<span className="nums">{ready.length}</span>}
          sub={ready.length > 0
            ? <>بقيمة <strong className="text-ink"><Money minor={links.readyMinor} /></strong>. إقرارها يرفع المربوط إلى <strong className="text-ink">{formatShare(coverage.afterBp)}</strong>.</>
            : "لا بند اتّفق عليه دليل فودكس صنفاً وعبوةً بعد."}
        >
          {canEdit && ready.length > 0 && <ApproveReady ids={ready.map((r) => r.supplierProductId)} count={ready.length} />}
        </KeyFigure>
        <KeyFigure
          icon={CircleCheck}
          label="بقي بلا ربط"
          value={<span className="nums">{open.length}</span>}
          sub={<>{countNoun(open.length, PRODUCT)} بقيمة <Money minor={open.reduce((s, r) => s + r.valueMinor, 0)} />. ما ليس مخزوناً (معدّات، خدمات) أخرجه فلا يسأل عنه.</>}
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4" title="ما «الجاهز»؟">
        بند في فاتورتنا يقابله في فودكس — للمورّد نفسه في الأيّام نفسها <strong className="text-ink">وبالمبلغ نفسه</strong> — بند شراء اختار له من أدخله صنف المخزون وكتب كمّيّته.
        فإن اتّفق {READY_MIN_MATCHES === 2 ? "شاهدان" : `${READY_MIN_MATCHES} شواهد`} فأكثر على الصنف وعلى ما في الوحدة عدّ جاهزاً. تقرّه أنت بضغطة، ولا يربط شيء وحده.
      </Callout>

      <div className="mt-5">
        <LinkTabs
          label="القائمة"
          items={[
            { href: "/finance/stock/links?view=ready", label: "جاهز بدليل", count: ready.length, active: view === "ready" },
            { href: "/finance/stock/links?view=open", label: "بلا ربط", count: open.length, active: view === "open" },
            { href: "/finance/stock/links?view=linked", label: "مربوط", count: linked.length, active: view === "linked" },
            { href: "/finance/stock/links?view=out", label: "ليس مخزوناً", count: out.length, active: view === "out" },
          ]}
        />
      </div>

      <Section title={view === "ready" ? "جاهز للإقرار" : view === "linked" ? "ما ربط" : view === "out" ? "ما أخرج" : "بلا ربط"} count={list.length}
        hint={list.length > SHOWN ? `أثقل ${SHOWN} قيمةً — اربطها فيظهر ما بعدها.` : "مرتّبة بقيمة ما اشتري منها."}>
        {list.length === 0 ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا شيء في هذه القائمة.</p>
        ) : (
          <StockLinkList rows={list.slice(0, SHOWN)} options={links.options} canEdit={canEdit} notStockKeys={keys} />
        )}
        {view === "ready" && list.length > 0 && (
          <p className="mt-2 text-[11px] text-muted">
            العبوة المقترحة «ما في وحدة الفاتورة الواحدة» بوحدة الصنف — كيس الكيلو {`«1 × 1000 ${storedUnitLabel("G")}»`}. عدّلها في النموذج إن رأيت غيرها.
          </p>
        )}
      </Section>
    </PageShell>
  );
}
