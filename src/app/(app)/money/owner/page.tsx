import { redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, HandCoins, Info, Scale, UserRound } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Callout, DataTable, EmptyState, KeyFigure, LinkButton, NoAccess, Section } from "@/components/ui";
import { formatDay } from "@/lib/riyadh-time";
import { OWNER_ENTRY_LABEL, signedMinor, type OwnerLine, type OwnerYear } from "@/lib/owner-account";
import { loadOwnerAccount } from "@/services/owner-account.service";
import { T } from "@/components/i18n/t";

export const dynamic = "force-dynamic";

/**
 * بينك وبين المقهى — ما دفعه المالكُ من جيبه وما أخذه، برصيدٍ جارٍ.
 *
 * جمعٌ لما صُنّف «تحويل شخصيّ» في الكشف ولما قُيّد دفعةً «من حساب المالك» —
 * لا حكمٌ محاسبيّ. وما لم يُصنَّف ليس هنا، فيُقال ذلك ومعه موضعُ تصنيفه.
 */
export default async function OwnerPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/money/owner");
  if (!can(user.role, "bank:view")) {
    return (
      <PageShell user={user} width="wide" title="بينك وبين المقهى">
        <NoAccess what="حساب المالك الجاري" />
      </PageShell>
    );
  }

  const a = await loadOwnerAccount();

  if (a.lines.length === 0) {
    return (
      <PageShell user={user} width="wide" title="بينك وبين المقهى" intro="ما دفعته من مالك الخاص للمقهى، وما أخذته منه.">
        <EmptyState
          icon={UserRound}
          title="لا توجد حركات بينك وبين المقهى بعد."
          hint="هنا تظهر حركات كشف البنك المصنّفة «تحويل شخصي»، وما سدّدته للمورّدين «من حساب المالك». صنّف تحويلاتك الشخصية في حركات البنك لتظهر هنا. ولن يعرض النظام رصيداً صفرياً وهو لا يعرف الحقيقة."
          action={<LinkButton href="/bank?show=unknown#transactions" variant="primary">صنّف حركات البنك</LinkButton>}
        />
      </PageShell>
    );
  }

  const owed = a.balanceMinor > 0;

  return (
    <PageShell
      user={user}
      width="wide"
      title="بينك وبين المقهى"
      eyebrow={a.bankFirstDay ? <><T s="كشف البنك من {0} إلى {1}" a={[<bdi key="0">{formatDay(a.bankFirstDay)}</bdi>, <bdi key="1">{formatDay(a.bankLastDay)}</bdi>]} /></> : undefined}
      intro="ما سدّدته عن المقهى من حسابك الشخصي وما أدخلته إليه، مقابل ما أخذته منه، كما صُنّف وسُجّل."
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={ArrowDownLeft}
          label="دفعته وأدخلته"
          value={<Money minor={a.paidForCafeMinor + a.putInMinor} />}
          sub={<><T s="سداد عن المقهى {0} · تحويل إلى حساب المقهى {1}" a={[<Money key="0" minor={a.paidForCafeMinor} />, <Money key="1" minor={a.putInMinor} />]} /></>}
        />
        <KeyFigure
          icon={ArrowUpRight}
          label="أخذته"
          value={<Money minor={a.tookOutMinor} />}
          sub="ما خرج من البنك مصنّفاً «تحويل شخصي». تفاصيله في القيود أدناه."
        />
        <KeyFigure
          icon={Scale}
          tone={a.balanceMinor < 0 ? "warn" : undefined}
          label={owed ? "المقهى مدين لك" : a.balanceMinor < 0 ? "أخذت أكثر مما أدخلت" : "متعادلان"}
          value={<Money minor={Math.abs(a.balanceMinor)} />}
          sub="ما دفعته وأدخلته مطروحاً منه ما أخذته، منذ أول حركة مسجّلة."
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4">
        <T s="{0} لا يُحسب هنا إلا ما صُنّف «تحويل شخصي» أو سُجّل «من حساب المالك». أما التحويل غير المصنّف وما دفعته نقداً بلا تسجيل فغير محسوبين. والتسمية المحاسبية (مسحوبات، جاري المالك، رأس مال) يحددها محاسبك." a={[<strong key="0" className="text-ink">هذا جمع للأرقام فقط:</strong>]} /></Callout>

      <Section title="سنة بسنة" icon={HandCoins} hint="يجيب عن سؤال «كم سحبت هذه السنة؟». السنة الأولى والأخيرة لا تشملان إلا ما يغطيه الكشف.">
        <DataTable<OwnerYear>
          rows={a.years}
          keyOf={(y) => y.year}
          columns={[
            { key: "year", header: "السنة", primary: true, cell: (y) => <span className="nums nums-count font-bold">{y.year}</span> },
            { key: "paid", header: "سدّدت عن المقهى", numeric: true, cell: (y) => <Money minor={y.paidForCafeMinor} /> },
            { key: "put", header: "أدخلت", numeric: true, cell: (y) => <Money minor={y.putInMinor} /> },
            { key: "took", header: "أخذت", numeric: true, cell: (y) => <Money minor={y.tookOutMinor} /> },
            { key: "net", header: "الصافي", numeric: true, cell: (y) => <Money minor={y.netMinor} signed /> },
          ]}
        />
      </Section>

      <Section title="القيود" icon={UserRound} count={a.lines.length} hint="الأحدث أولاً، والرصيد يظهر بعد كل حركة. اضغط السطر لتفتح الحركة في البنك أو صفحة المورّد الذي سُدّد له.">
        <DataTable<OwnerLine>
          rows={a.lines}
          keyOf={(l) => l.id}
          hrefOf={(l) => l.href}
          searchOf={(l) => `${l.label} ${OWNER_ENTRY_LABEL[l.kind]}`}
          columns={[
            { key: "day", header: "التاريخ", cell: (l) => <bdi>{formatDay(l.day)}</bdi> },
            {
              key: "label",
              header: "البيان",
              primary: true,
              cell: (l) => (
                <span className="min-w-0">
                  <span className="block truncate font-bold">{l.label}</span>
                  <span className="mt-0.5 block"><Badge tone={l.kind === "TOOK_OUT" ? "warn" : "ok"}>{OWNER_ENTRY_LABEL[l.kind]}</Badge></span>
                </span>
              ),
            },
            { key: "amount", header: "المبلغ", numeric: true, cell: (l) => <Money minor={signedMinor(l)} signed /> },
            { key: "balance", header: "الرصيد بعدها", numeric: true, secondary: true, cell: (l) => <Money minor={l.balanceMinor} signed /> },
          ]}
        />
      </Section>
    </PageShell>
  );
}
