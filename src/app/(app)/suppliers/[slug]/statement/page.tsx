import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowRight, ScrollText } from "lucide-react";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { companyConfig } from "@/config/drive";
import { mainClass } from "@/components/page-shell";
import { Money } from "@/components/money";
import { EmptyState, LinkTabs, NoAccess, buttonClass } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { loadFirstActivity, loadStatementLedger } from "@/services/supplier-intel.service";
import { loadSupplierBalances } from "@/services/supplier-balance.service";
import { METHOD_LABEL } from "@/lib/payment-state";
import { formatDay, todayInRiyadh } from "@/lib/riyadh-time";

export const dynamic = "force-dynamic";

/**
 * كشفُ حساب المورّد — ورقةٌ تُطبَع أو تُحفَظ PDF.
 *
 * من قيودنا وحدها: رصيدٌ افتتاحيّ، ثمّ الفواتير والمدفوعات بترتيبها ورصيدٌ
 * جارٍ، ثمّ الختاميّ. يُرسَل إلى المورّد ليقابله بدفاتره، أو يُعطى المحاسب.
 *
 * والرصيدُ الذي تقوله بقيّةُ الشاشات («عليك له») من `loadSupplierBalances`
 * يُكتب تحت الختاميّ؛ فإن اختلفا قيل الفرقُ ولم يُطوَ — الكشفُ يجمع
 * الإجماليّات، والمصدرُ يُسقط كسور الهللة على الفواتير المسدَّدة.
 *
 * وما حوله (الشريطُ والألسنةُ والأزرار) `.no-print`: يسقط من الورقة.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function safe(read: () => string): string {
  try {
    return read();
  } catch {
    return "";
  }
}

export default async function SupplierStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/suppliers");

  const { slug } = await params;
  const [s] = await db.select().from(suppliers).where(eq(suppliers.slug, slug));
  if (!s) notFound();

  if (!can(user.role, "amounts:view")) {
    return (
      <main id="main" className={mainClass("page")}>
        <title>{`كشف حساب ${s.nameAr} · ذا بوبليك هاوس`}</title>
        <NoAccess what="كشف حساب المورّد" />
      </main>
    );
  }

  const q = await searchParams;
  const today = todayInRiyadh();
  const first = await loadFirstActivity(s.id);

  const to = q.to && DAY_RE.test(q.to) ? q.to : today;
  const from = q.from && DAY_RE.test(q.from) && q.from <= to ? q.from : first ?? to;

  const [ledger, [bal]] = await Promise.all([
    loadStatementLedger(s.id, from, to),
    loadSupplierBalances(db, s.id),
  ]);

  const year = today.slice(0, 4);
  const presets = [
    { label: "كلّ التعامل", from: first ?? today, to: today },
    { label: "هذه السنة", from: `${year}-01-01`, to: today },
    { label: "آخر 90 يوماً", from: shiftDays(today, -89), to: today },
    { label: "آخر 30 يوماً", from: shiftDays(today, -29), to: today },
  ];

  /* الرصيدُ عند المصدر الواحد — يُقارَن بختاميّ الكشف حين يمتدّ الكشف إلى اليوم */
  const systemNet = bal ? bal.owedMinor - bal.creditLeftMinor : null;
  const coversToday = to === today;
  const drift = coversToday && systemNet !== null ? ledger.closingMinor - systemNet : 0;

  const base = `/suppliers/${s.slug}/statement`;
  const vat = safe(() => companyConfig.vatNumber);
  const cr = safe(() => companyConfig.crNumber);

  return (
    <main id="main" className={mainClass("page")}>
      <title>{`كشف حساب ${s.nameAr} · ذا بوبليك هاوس`}</title>
      {/* ورقةٌ بيضاء بهوامش A4 — وما سواها يسقط */}
      <style>{`@media print { @page { size: A4; margin: 14mm 12mm; } aside[aria-label="وضع التجربة"] { display: none !important; } }`}</style>

      {/* ── الشريط: رجوعٌ، والفترة، والطباعة — لا يُطبَع ── */}
      <div className="no-print mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/suppliers/${s.slug}`} className="inline-flex min-h-11 items-center gap-1.5 text-xs font-bold text-ink-soft hover:text-accent sm:min-h-0">
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            ملفّ {s.nameAr}
          </Link>
          <PrintButton />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <LinkTabs
            label="فترة الكشف"
            items={presets.map((p) => ({
              href: `${base}?from=${p.from}&to=${p.to}`,
              label: p.label,
              active: p.from === from && p.to === to,
            }))}
          />
          {/* فترةٌ بعينها: نموذجٌ يذهب إلى العنوان نفسه — يعمل بلا سكربت */}
          <form action={base} className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">من</span>
              <input type="date" name="from" defaultValue={from} className="min-h-11 rounded-lg border border-line-input bg-raised px-2.5 sm:min-h-9" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">إلى</span>
              <input type="date" name="to" defaultValue={to} max={today} className="min-h-11 rounded-lg border border-line-input bg-raised px-2.5 sm:min-h-9" />
            </label>
            <button type="submit" className={buttonClass("secondary", "sm")}>اعرض</button>
          </form>
        </div>
      </div>

      {/* ── الورقة ── */}
      <article className="rounded-2xl border border-line bg-raised p-5 shadow-raised sm:p-8 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-wide text-muted">كشف حساب مورّد</p>
            <h1 className="mt-1 text-2xl font-extrabold leading-tight">{s.nameAr}</h1>
            <p className="mt-1.5 text-xs text-ink-soft">
              {s.vatNumber ? <>الرقم الضريبيّ <bdi dir="ltr" className="font-mono">{s.vatNumber}</bdi></> : "لا رقمَ ضريبيّاً مسجَّلاً له"}
              {s.crNumber && <> · السجلّ <bdi dir="ltr" className="font-mono">{s.crNumber}</bdi></>}
            </p>
          </div>
          <div className="text-end text-xs leading-relaxed text-ink-soft">
            <p className="text-sm font-bold text-ink">{companyConfig.nameAr}</p>
            <p>النسيم، جدة</p>
            {vat && <p>الرقم الضريبيّ <bdi dir="ltr" className="font-mono">{vat}</bdi></p>}
            {cr && <p>السجلّ التجاريّ <bdi dir="ltr" className="font-mono">{cr}</bdi></p>}
          </div>
        </header>

        <dl className="mt-5 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted">الفترة</dt>
            <dd className="mt-1 font-bold">{formatDay(from)} — {formatDay(to)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">صدر في</dt>
            <dd className="mt-1 font-bold">{formatDay(today)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">الرصيد الافتتاحيّ</dt>
            <dd className="mt-1 text-sm font-bold"><Balance minor={ledger.openingMinor} /></dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">الرصيد الختاميّ</dt>
            <dd className="mt-1 text-sm font-bold"><Balance minor={ledger.closingMinor} /></dd>
          </div>
        </dl>

        {ledger.rows.length === 0 && ledger.openingMinor === 0 ? (
          <div className="mt-6">
            <EmptyState
              compact
              icon={ScrollText}
              title="لا قيد في هذه الفترة."
              hint={first ? `أوّلُ تعاملٍ معه في ${formatDay(first)} — اختر «كلّ التعامل».` : "لا فاتورة منه ولا دفعة له بعد."}
            />
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[34rem] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-y border-line bg-sunken text-[11px] text-muted print:bg-transparent">
                  <th scope="col" className="px-2.5 py-2 text-start font-bold">التاريخ</th>
                  <th scope="col" className="px-2.5 py-2 text-start font-bold">البيان</th>
                  <th scope="col" className="px-2.5 py-2 text-start font-bold">فواتير (علينا)</th>
                  <th scope="col" className="px-2.5 py-2 text-start font-bold">مدفوعات (منّا)</th>
                  <th scope="col" className="px-2.5 py-2 text-start font-bold">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line-soft text-ink-soft">
                  <td className="whitespace-nowrap px-2.5 py-2">{formatDay(from)}</td>
                  <td className="px-2.5 py-2 font-bold">رصيدٌ مُرحَّل</td>
                  <td className="px-2.5 py-2" />
                  <td className="px-2.5 py-2" />
                  <td className="nums-col px-2.5 py-2 font-bold"><Balance minor={ledger.openingMinor} /></td>
                </tr>
                {ledger.rows.map((r) => (
                  <tr key={`${r.kind}:${r.id}`} className="border-b border-line-soft break-inside-avoid">
                    <td className="whitespace-nowrap px-2.5 py-2 text-ink-soft">{formatDay(r.date)}</td>
                    <td className="px-2.5 py-2">
                      {r.kind === "INVOICE" ? (
                        <>فاتورة <bdi dir="ltr" className="font-mono">{r.reference}</bdi></>
                      ) : (
                        <>سداد · {METHOD_LABEL[r.reference] ?? r.reference}</>
                      )}
                    </td>
                    <td className="nums-col px-2.5 py-2">{r.kind === "INVOICE" ? <Money minor={r.amountMinor} /> : null}</td>
                    <td className="nums-col px-2.5 py-2">{r.kind === "PAYMENT" ? <Money minor={r.amountMinor} /> : null}</td>
                    <td className="nums-col px-2.5 py-2 font-medium"><Balance minor={r.balanceMinor} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink font-bold">
                  <td className="px-2.5 py-2.5" colSpan={2}>المجموع والرصيد الختاميّ</td>
                  <td className="nums-col px-2.5 py-2.5"><Money minor={ledger.invoicedMinor} /></td>
                  <td className="nums-col px-2.5 py-2.5"><Money minor={ledger.paidMinor} /></td>
                  <td className="nums-col px-2.5 py-2.5"><Balance minor={ledger.closingMinor} /></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <footer className="mt-6 space-y-1.5 border-t border-line pt-4 text-[11px] leading-relaxed text-muted">
          <p>
            الرصيدُ الموجب مستحقٌّ للمورّد علينا، والسالبُ رصيدٌ لنا عنده. المدفوعاتُ بما وصل المورّد بعد رسم التحويل،
            والمردودةُ والملغاةُ لا تدخل.
          </p>
          {coversToday && drift !== 0 && (
            <p className="text-ink-soft">
              وحسابُه في النظام اليوم <Balance minor={systemNet ?? 0} />، والفرقُ <Money minor={Math.abs(drift)} /> كسورُ تقريبٍ
              على فواتير عُدّت مسدَّدة — أو تخصيصٌ يستحقّ المراجعة في ملفّه.
            </p>
          )}
          <p>صدر من نظام {companyConfig.nameAr} بتاريخ {formatDay(today)} — من القيود المسجَّلة حتى تاريخه.</p>
        </footer>
      </article>
    </main>
  );
}

/** رصيدٌ بجهته: «علينا» أو «لنا» — والإشارةُ وحدها لا تُقرأ في ورقة. */
function Balance({ minor }: { minor: number }) {
  if (minor === 0) return <Money minor={0} />;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <Money minor={Math.abs(minor)} />
      <span className={`text-[10px] font-bold ${minor > 0 ? "text-warn" : "text-ok"}`}>{minor > 0 ? "علينا" : "لنا"}</span>
    </span>
  );
}
