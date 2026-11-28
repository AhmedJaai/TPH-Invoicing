import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarRange, HandCoins, Info, UserRound, X, type LucideIcon } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, DataTable, EmptyState, LinkButton, LinkTabs, NoAccess, Section } from "@/components/ui";
import { formatDay, formatMonth } from "@/lib/riyadh-time";
import { OWNER_ENTRY_LABEL, signedMinor, type OwnerEntryKind, type OwnerLine, type OwnerMonth, type OwnerYear } from "@/lib/owner-account";
import { loadOwnerAccount } from "@/services/owner-account.service";
import { T } from "@/components/i18n/t";
import { OwnerPaymentSource } from "@/components/owner-payment-source";

export const dynamic = "force-dynamic";

/**
 * بينك وبين المقهى — ما دفعه المالكُ من جيبه وما أخذه، برصيدٍ جارٍ.
 *
 * جمعٌ لما صُنّف «تحويل شخصيّ» في الكشف ولما قُيّد دفعةً «من حساب المالك» —
 * لا حكمٌ محاسبيّ. وما لم يُصنَّف ليس هنا، فيُقال ذلك ومعه موضعُ تصنيفه.
 */
export default async function OwnerPage({ searchParams }: { searchParams: Promise<{ kind?: string; month?: string }> }) {
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

  const p = await searchParams;
  const kind = p.kind && Object.hasOwn(OWNER_ENTRY_LABEL, p.kind) ? (p.kind as OwnerEntryKind) : null;
  const month = p.month && a.months.some((m) => m.month === p.month) ? p.month : null;
  const owed = a.balanceMinor > 0;
  /* «من تحويلات المقهى» يُخصم من تحويلاتك في قائمة الدخل — قرارُ من يملك السداد */
  const canDecide = can(user.role, "payment:approve");
  const inMinor = a.paidForCafeMinor + a.putInMinor;
  const scale = Math.max(inMinor, a.tookOutMinor, 1);
  const latest = a.months[0];
  const inMonth = month ? a.lines.filter((l) => l.day.startsWith(month)) : a.lines;
  const shown = kind ? inMonth.filter((l) => l.kind === kind) : inMonth;
  const href = (next: { kind?: OwnerEntryKind | null; month?: string | null }) => {
    const q = new URLSearchParams();
    const k = next.kind === undefined ? kind : next.kind;
    const m = next.month === undefined ? month : next.month;
    if (k) q.set("kind", k);
    if (m) q.set("month", m);
    const qs = q.toString();
    return `/money/owner${qs ? `?${qs}` : ""}#lines`;
  };

  return (
    <PageShell
      user={user}
      width="wide"
      title="بينك وبين المقهى"
      eyebrow={a.bankFirstDay ? <><T s="كشف البنك من {0} إلى {1}" a={[<bdi key="0">{formatDay(a.bankFirstDay)}</bdi>, <bdi key="1">{formatDay(a.bankLastDay)}</bdi>]} /></> : undefined}
      intro="ما وضعته في المقهى من مالك، وما أخذته منه، والرصيد بينكما بعد كل حركة."
    >
      {/* ── الجواب: من مدينٌ لمن، وبكم ── */}
      <section aria-labelledby="owner-answer" className="overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
        <div className="p-4 sm:p-6">
          <p className="text-xs font-bold text-muted">منذ أول حركة مسجّلة</p>
          <h2 id="owner-answer" className={`mt-1 text-[1.4rem] font-bold leading-snug sm:text-[1.7rem] ${a.balanceMinor < 0 ? "text-warn" : ""}`}>
            {owed
              ? <T s="المقهى مدين لك بـ{0}" a={[<Money key="0" minor={a.balanceMinor} />]} />
              : a.balanceMinor < 0
                ? <T s="أخذت أكثر مما وضعت بـ{0}" a={[<Money key="0" minor={-a.balanceMinor} />]} />
                : "متعادلان: ما وضعته يساوي ما أخذته"}
          </h2>
          {/* شريطان بمقياسٍ واحد — الأطولُ هو الأكبر، والرقمُ مكتوبٌ بجانبه */}
          <dl className="mt-5 space-y-3">
            <Bar icon={ArrowDownLeft} label="وضعته في المقهى" minor={inMinor} pct={(inMinor / scale) * 100} tone="bg-ok"
              note={<T s="سداد عن المقهى {0} · تحويل إلى حسابه {1}" a={[<Money key="0" minor={a.paidForCafeMinor} />, <Money key="1" minor={a.putInMinor} />]} />} />
            <Bar icon={ArrowUpRight} label="أخذته منه" minor={a.tookOutMinor} pct={(a.tookOutMinor / scale) * 100} tone="bg-warn"
              note="ما خرج من البنك مصنّفاً «تحويل شخصي»" />
          </dl>
        </div>
        {latest && (
          <Link href={href({ month: latest.month, kind: null })} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line-soft px-4 py-3 text-xs transition-colors hover:bg-hover sm:px-6">
            <span className="font-bold">{formatMonth(latest.month)}</span>
            <span className="text-ink-soft">
              <T s="وضعت {0} · أخذت {1} · الصافي {2}" a={[<Money key="0" minor={latest.paidForCafeMinor + latest.putInMinor} />, <Money key="1" minor={latest.tookOutMinor} />, <b key="2"><Money minor={latest.netMinor} signed /></b>]} />
            </span>
          </Link>
        )}
        <p className="flex items-start gap-2 border-t border-line-soft bg-sunken/50 px-4 py-3 text-xs leading-relaxed text-muted sm:px-6">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span>جمع للأرقام لا حكم محاسبي: يُحسب ما صُنّف «تحويل شخصي» أو سُجّل «من حساب المالك» وحده. التحويل غير المصنّف وما دفعته نقداً بلا تسجيل غير محسوبين، والتسمية (مسحوبات، جاري المالك، رأس مال) يحددها محاسبك. <Link href="/bank?show=unknown#transactions" className="inline-flex min-h-11 items-center font-bold text-accent hover:underline sm:min-h-0">صنّف الحركات غير المعروفة</Link></span>
        </p>
      </section>

      <Section title="شهراً بشهر" icon={CalendarRange} hint="الرصيد في آخر كل شهر يُظهر متى اتسع الفرق. اضغط الشهر لترى حركاته.">
        <DataTable<OwnerMonth>
          rows={a.months}
          keyOf={(m) => m.month}
          hrefOf={(m) => href({ month: m.month, kind: null })}
          columns={[
            { key: "month", header: "الشهر", primary: true, cell: (m) => <span className="font-bold">{formatMonth(m.month)}</span> },
            { key: "in", header: "وضعت", numeric: true, cell: (m) => <Money minor={m.paidForCafeMinor + m.putInMinor} /> },
            { key: "took", header: "أخذت", numeric: true, cell: (m) => <Money minor={m.tookOutMinor} /> },
            { key: "net", header: "صافي الشهر", numeric: true, cell: (m) => <Money minor={m.netMinor} signed /> },
            { key: "end", header: "الرصيد آخره", numeric: true, secondary: true, cell: (m) => <Money minor={m.endBalanceMinor} signed /> },
          ]}
        />
        {a.years.length > 1 && (
          <div className="mt-6">
            <h3 className="mb-2 text-[13px] font-bold">سنة بسنة</h3>
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
          </div>
        )}
      </Section>

      <Section
        id="lines"
        title={month ? `الحركات في ${formatMonth(month)}` : "الحركات"}
        icon={UserRound}
        count={shown.length}
        hint="الأحدث أولاً، والرصيد بعد كل حركة. اضغط السطر لتفتح الحركة في البنك أو صفحة المورّد."
        action={month ? <LinkButton href={href({ month: null })} size="sm" variant="quiet" icon={X}>كل الأشهر</LinkButton> : undefined}
      >
        <div className="mb-3">
          <LinkTabs
            label="نوع الحركة"
            items={[
              { href: href({ kind: null }), label: "الكل", count: inMonth.length, active: kind === null },
              ...(Object.keys(OWNER_ENTRY_LABEL) as OwnerEntryKind[]).map((k) => ({
                href: href({ kind: k }), label: OWNER_ENTRY_LABEL[k], count: inMonth.filter((l) => l.kind === k).length, active: kind === k,
              })),
            ]}
          />
        </div>
        {canDecide && shown.some((l) => l.payment) && (
          <p className="mb-3 flex items-start gap-2 text-xs leading-relaxed text-muted">
            <HandCoins className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span>ما سدّدته للمورّدين اختر مصدره في سطره: «من تحويلات المقهى» يُخصم من التحويلات إليك في «كم ربحت؟» فلا يُحسب مرتين، و«من مالي الخاص» لا يُخصم.</span>
          </p>
        )}
        <DataTable<OwnerLine>
          rows={shown}
          keyOf={(l) => l.id}
          hrefOf={(l) => l.href}
          searchOf={(l) => `${l.label} ${OWNER_ENTRY_LABEL[l.kind]}`}
          empty={<EmptyState compact title="لا حركات بهذا التصفية." hint="غيّر النوع أو الشهر." />}
          columns={[
            { key: "day", header: "التاريخ", cell: (l) => <bdi className="whitespace-nowrap">{formatDay(l.day)}</bdi> },
            {
              key: "label",
              header: "البيان",
              primary: true,
              cell: (l) => (
                <span className="min-w-0">
                  <span className="block break-words font-bold">{l.label}</span>
                  <span className="mt-0.5 block"><Badge tone={l.kind === "TOOK_OUT" ? "warn" : "ok"}>{OWNER_ENTRY_LABEL[l.kind]}</Badge></span>
                  {l.payment && canDecide && <OwnerPaymentSource paymentId={l.payment.id} fromTransfers={l.payment.fromTransfers} />}
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

function Bar({ icon: Icon, label, minor, pct, tone, note }: { icon: LucideIcon; label: string; minor: number; pct: number; tone: string; note: React.ReactNode }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <dt className="flex items-center gap-1.5 text-xs font-bold text-ink-soft"><Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />{label}</dt>
        <dd className="text-[15px] font-bold"><Money minor={minor} /></dd>
      </div>
      <div aria-hidden className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-sunken">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, minor > 0 ? 1 : 0)}%` }} />
      </div>
      <dd className="mt-1 text-[11px] text-muted">{note}</dd>
    </div>
  );
}
