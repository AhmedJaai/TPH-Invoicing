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
      <PageShell user={user} width="wide" title="بينك وبين المقهى" intro="ما دفعته من جيبك للمقهى، وما أخذته منه.">
        <EmptyState
          icon={UserRound}
          title="لا شيء مقيّد بينك وبين المقهى بعد."
          hint="يجمع هنا ما صنّف في كشف البنك «تحويل شخصيّ»، وما سدّد لمورّد بطريقة «من حساب المالك». صنّف تحويلاتك الشخصيّة في حركة البنك فتظهر — ولا يعرض رصيد صفر عن غير علم."
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
      eyebrow={a.bankFirstDay ? <>كشف البنك من <bdi>{formatDay(a.bankFirstDay)}</bdi> إلى <bdi>{formatDay(a.bankLastDay)}</bdi></> : undefined}
      intro="ما سدّدته من حسابك الشخصيّ عن المقهى وما أدخلته إليه، مقابل ما أخذته منه — ممّا صنّف وقيّد."
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        <KeyFigure
          icon={ArrowDownLeft}
          label="دفعته وأدخلته"
          value={<Money minor={a.paidForCafeMinor + a.putInMinor} />}
          sub={<>سداد عن المقهى <Money minor={a.paidForCafeMinor} /> · تحويل إلى حسابه <Money minor={a.putInMinor} /></>}
        />
        <KeyFigure
          icon={ArrowUpRight}
          label="أخذته"
          value={<Money minor={a.tookOutMinor} />}
          sub="صادر البنك المصنّف «تحويل شخصيّ» — قيوده أدناه."
        />
        <KeyFigure
          icon={Scale}
          tone={a.balanceMinor < 0 ? "warn" : undefined}
          label={owed ? "المقهى مدين لك" : a.balanceMinor < 0 ? "أخذت أكثر ممّا أدخلت" : "متعادلان"}
          value={<Money minor={Math.abs(a.balanceMinor)} />}
          sub="ما دفعته وأدخلته ناقصاً ما أخذته — منذ أوّل ما في السجلّ."
        />
      </div>

      <Callout tone="info" icon={Info} className="mt-4">
        <strong className="text-ink">جمع لا حكم:</strong> يحسب ما صنّف «تحويل شخصيّ» وما قيّد «من حساب المالك» وحدهما. تحويل لم يصنّف، أو ما
        دفعته نقداً بلا قيد، ليس هنا — والتسمية المحاسبيّة (مسحوبات، جاري المالك، رأس مال) لمحاسبك.
      </Callout>

      <Section title="سنةً بسنة" icon={HandCoins} hint="«كم سحبت هذا العام؟» — وأوّل سنة وآخرها بقدر ما يغطّيه الكشف.">
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

      <Section title="القيود" icon={UserRound} count={a.lines.length} hint="الأحدث أوّلاً، وبعد كلّ رصيده. والسطر يفتح حركته في البنك أو ملفّ المورّد الذي سدّد.">
        <DataTable<OwnerLine>
          rows={a.lines}
          keyOf={(l) => l.id}
          hrefOf={(l) => l.href}
          searchOf={(l) => `${l.label} ${OWNER_ENTRY_LABEL[l.kind]}`}
          columns={[
            { key: "day", header: "اليوم", cell: (l) => <bdi>{formatDay(l.day)}</bdi> },
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
            { key: "balance", header: "الرصيد بعده", numeric: true, secondary: true, cell: (l) => <Money minor={l.balanceMinor} signed /> },
          ]}
        />
      </Section>
    </PageShell>
  );
}
