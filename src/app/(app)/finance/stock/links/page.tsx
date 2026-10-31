import { redirect } from "next/navigation";
import { ArrowRight, CircleCheck, Info, Link2, Scale } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { ApproveReady, StockLinkList } from "@/components/stock-link-list";
import { Callout, KeyFigure, LinkButton, LinkTabs, NoAccess, Section } from "@/components/ui";
import { ITEM, PRODUCT, countNoun } from "@/lib/arabic";
import { formatShare } from "@/lib/finance/format";
import { storedUnitLabel } from "@/lib/unit-conversion";
import { coverageAfterReady, isReady, loadStockLinks, notStockKey, READY_MIN_MATCHES } from "@/services/stock-link.service";
import { T } from "@/components/i18n/t";

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
      intro="اسم الصنف في الفاتورة يختلف عن اسمه في الوصفة. اربط كل بند بصنف المخزون، وحدّد كم تحتوي الوحدة الواحدة منه. يكفي أن تفعل ذلك مرة واحدة، وتعتمد عليه كل التقارير بعدها."
      actions={<LinkButton href="/finance/stock" variant="quiet" size="sm" icon={ArrowRight}>المشترى والمباع</LinkButton>}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={Link2}
          label="المربوط من قيمة المشتريات"
          tone={(coverage.nowBp ?? 0) >= 8_000 ? "ok" : "warn"}
          value={<span className="nums">{formatShare(coverage.nowBp)}</span>}
          sub={<><T s="{0} من {1} من مشتريات كل الفترات، وهي البنود المربوطة بصنف معروف العبوة. يظهر الصنف في تقرير «المشترى والمباع» حين يبلغ المربوط منه أربعة أخماس ما أُدخل في فودكس." a={[<Money key="0" minor={links.measuredMinor} />, <Money key="1" minor={links.totalMinor - links.notStockMinor} />]} /></>}
        />
        <KeyFigure
          icon={Scale}
          label="جاهز بتأكيد فودكس"
          value={<span className="nums">{ready.length}</span>}
          sub={ready.length > 0
            ? <><T s="بقيمة {0}. باعتمادها يرتفع المربوط إلى {1}." a={[<strong key="0" className="text-ink"><Money minor={links.readyMinor} /></strong>, <strong key="1" className="text-ink">{formatShare(coverage.afterBp)}</strong>]} /></>
            : "لا يوجد حتى الآن بند يؤكد فودكس صنفه وعبوته."}
        >
          {canEdit && ready.length > 0 && <ApproveReady ids={ready.map((r) => r.supplierProductId)} count={ready.length} />}
        </KeyFigure>
        <KeyFigure
          icon={CircleCheck}
          label="بقي بلا ربط"
          value={<span className="nums">{open.length}</span>}
          sub={<><T s="{0} بقيمة {1}. أخرج من القائمة ما ليس مخزوناً (معدات أو خدمات) حتى لا تُسأل عنه." a={[countNoun(open.length, PRODUCT), <Money key="1" minor={open.reduce((s, r) => s + r.valueMinor, 0)} />]} /></>}
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4" title="ما معنى «جاهز»؟">
        <T s="هو بند في فاتورتنا يقابله بند في فودكس للمورّد نفسه في الأيام نفسها {0}، وقد حدّد من أدخله صنف المخزون وكميته. فإذا تأكد الصنف والكمية في الوحدة {1} فأكثر، صار البند جاهزاً. تعتمده أنت بضغطة واحدة، ولا يُربط شيء تلقائياً." a={[<strong key="0" className="text-ink">وبالمبلغ نفسه</strong>, countNoun(READY_MIN_MATCHES, ITEM)]} /></Callout>

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

      <Section title={view === "ready" ? "جاهز للاعتماد" : view === "linked" ? "المربوط" : view === "out" ? "ليس مخزوناً" : "بلا ربط"} count={list.length}
        hint={list.length > SHOWN ? `أعلى ${countNoun(SHOWN, ITEM)} قيمةً. اربطها لتظهر البقية.` : "مرتبة حسب قيمة المشتريات."}>
        {list.length === 0 ? (
          <p className="rounded-xl border border-line bg-raised px-4 py-3 text-xs text-muted shadow-raised">لا توجد بنود في هذه القائمة.</p>
        ) : (
          <StockLinkList rows={list.slice(0, SHOWN)} options={links.options} canEdit={canEdit} notStockKeys={keys} />
        )}
        {view === "ready" && list.length > 0 && (
          <p className="mt-2 text-[11px] text-muted">
            <T s="العبوة المقترحة هي ما تحتويه وحدة الفاتورة الواحدة بوحدة الصنف، فكيس الكيلو {0}. عدّلها في النموذج إن كانت مختلفة." a={[`«1 × 1000 ${storedUnitLabel("G")}»`]} /></p>
        )}
      </Section>
    </PageShell>
  );
}
