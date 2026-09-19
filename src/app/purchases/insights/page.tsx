import Link from "next/link";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { NoAccess, Section, Stat, StatGrid } from "@/components/ui";
import { FindingsList, RunAnalysis, type FindingView } from "@/components/ai-analysis";
import { loadBalanceTotals } from "@/services/supplier-balance.service";
import { listOpenFindings } from "@/services/supplier-analysis.service";
import { countNoun, SUPPLIER } from "@/lib/arabic";

export const dynamic = "force-dynamic";

/**
 * «عليك لكلّ مورّد» — جوابُ سؤال أحمد الأوّل، وتحته ما يقترحه التحليل
 * لتصحيح حسابٍ بدا معوجّاً.
 *
 * وكان اسمُها «تحليل الذكاء»: الصفحةُ التي تحمل الجواب الوحيد لـ«كم أدين
 * ولمن؟» مسمّاةٌ بالأداة التي تحسبه لا بالسؤال الذي تجيبه — فلا يفتحها
 * من يسأله. والجدول أوّلاً لأنّه المقصود، والاقتراحات تحته لأنّها عملٌ
 * آخر يُفتح حين يُراد.
 *
 * الأرقام في أعلى الصفحة محسوبة (لا يكتبها النموذج): ما عليك بعد خصم ما
 * دفعتَه، وما لك عند مورّدين بلا فواتير. والاقتراحات تحتها تنتظر قرارك:
 * تُقرّ فيُصحَّح الحساب بالخدمات نفسها التي يمرّ بها العمل اليدويّ، أو
 * تُرفض فيتعلّم منها التحليل القادم.
 */
export default async function InsightsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/purchases/insights");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} title="عليك لكلّ مورّد">
        <NoAccess what="حسابات المورّدين" />
      </PageShell>
    );
  }

  const [{ rows, totals }, open] = await Promise.all([loadBalanceTotals(), listOpenFindings()]);

  const ids = rows.map((r) => r.supplierId);
  const names = ids.length === 0
    ? []
    : await db.select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug })
        .from(suppliers).where(inArray(suppliers.id, ids));
  const nameOf = new Map(names.map((n) => [n.id, n]));

  /* ما يستحقّ التحليل: مورّدٌ عليه لنا، أو لنا عنده — الأكبر أوّلاً */
  const worth = rows
    .filter((r) => r.owedMinor > 0 || r.creditMinor > 0)
    .sort((a, b) => (b.owedMinor + b.creditMinor) - (a.owedMinor + a.creditMinor));

  const findings: FindingView[] = open.map((f) => ({
    id: f.id, supplierId: f.supplierId, supplierName: f.supplierName, supplierSlug: f.supplierSlug,
    kind: f.kind, severity: f.severity, title: f.title, explanation: f.explanation,
    amountMinor: f.amountMinor, action: f.action,
    refs: f.refs.map((r) => ({ label: r.label, type: r.type })),
    createdAt: f.createdAt.toISOString(),
  }));

  const canAnalyze = can(user.role, "supplier:edit");
  const canApprove = can(user.role, "payment:approve");

  return (
    <PageShell
      user={user}
      width="wide"
      title="عليك لكلّ مورّد"
      intro="كم عليك لكلّ مورّد بعد خصم ما دفعتَه له، وما يقترحه التحليل لتصحيح حسابه."
    >
      <StatGrid>
        <Stat
          label="عليك للمورّدين"
          minor={totals.owedMinor}
          tone={totals.owedMinor > 0 ? "warn" : "ok"}
          sub={`${countNoun(totals.owedSuppliers, SUPPLIER)} · بعد خصم ما دفعتَه لهم`}
        />
        <Stat
          label="خُصم من فواتيرهم"
          minor={totals.offsetMinor}
          sub="مالٌ دفعتَه لنفس المورّد ولم يُخصم من فاتورة"
        />
        <Stat
          label="لك عند مورّدين"
          minor={totals.creditLeftMinor}
          tone={totals.creditLeftMinor > 0 ? "warn" : undefined}
          sub={`${countNoun(totals.creditSuppliers, SUPPLIER)} · اطلب فواتيرهم`}
        />
        <Stat
          label="اقتراحات تنتظرك"
          value={String(findings.length)}
          tone={findings.length > 0 ? "warn" : "ok"}
          sub={findings.length > 0 ? "راجعها تحت" : "حلّل الحسابات لترى"}
        />
      </StatGrid>

      {/* الجدول أوّلاً: هو الجواب، وما تحته عملٌ يُفتح حين يُراد */}
      <Section title="حساب كلّ مورّد" hint="المفتوح على فواتيره، وما دفعتَه له ولم يُخصم، والصافي.">
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
          {worth.map((r) => {
            const n = nameOf.get(r.supplierId);
            return (
              <li key={r.supplierId} className="grid grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-sm sm:grid-cols-4">
                <Link href={`/suppliers/${n?.slug ?? ""}`} className="col-span-2 font-bold underline-offset-2 hover:underline sm:col-span-1">
                  {n?.nameAr ?? "مورّد"}
                </Link>
                <span className="text-xs text-muted">مفتوح <span className="nums text-ink"><Money minor={r.openMinor} /></span></span>
                <span className="text-xs text-muted">دفعتَ بلا خصم <span className="nums text-ink"><Money minor={r.creditMinor} /></span></span>
                <span className={`text-xs font-bold ${r.owedMinor > 0 ? "text-warn" : r.creditLeftMinor > 0 ? "text-ok" : "text-muted"}`}>
                  {r.owedMinor > 0
                    ? <>عليك <span className="nums"><Money minor={r.owedMinor} /></span></>
                    : r.creditLeftMinor > 0
                      ? <>لك عنده <span className="nums"><Money minor={r.creditLeftMinor} /></span></>
                      : "متّزن"}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="اقتراحات تنتظر قرارك">
        {findings.length === 0 ? (
          <p className="text-sm text-muted">لا اقتراحات مفتوحة.</p>
        ) : (
          <FindingsList findings={findings} canApprove={canApprove} showSupplier />
        )}
      </Section>

      {canAnalyze && (
        <Section
          title="حلّل الحسابات"
          hint="يمرّ على كلّ مورّدٍ عليك له أو لك عنده، واحداً واحداً. التحليل القديم يُستبدل، وقراراتك السابقة يقرؤها التحليل الجديد."
        >
          <RunAnalysis
            suppliers={worth.map((r) => ({ id: r.supplierId, name: nameOf.get(r.supplierId)?.nameAr ?? "مورّد" }))}
            label={`حلّل ${countNoun(worth.length, SUPPLIER)} بالذكاء`}
          />
        </Section>
      )}
    </PageShell>
  );
}
