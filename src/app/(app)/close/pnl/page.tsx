import Link from "next/link";
import { redirect } from "next/navigation";
import { CircleHelp, Info, Scale } from "lucide-react";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Money } from "@/components/money";
import { Badge, Callout, Card, KeyFigure, LinkButton, LinkTabs, NoAccess, Section } from "@/components/ui";
import { DAY, INVOICE, countNoun } from "@/lib/arabic";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh, formatMonth } from "@/lib/riyadh-time";
import { loadIncomeSheet } from "@/services/income-sheet.service";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** موضعُ تفصيل كلّ سطر — الرقمُ بلا وجهةٍ لا يُفحَص. */
function hrefOf(id: string, month: string): string | null {
  if (id === "sales") return `/close/vat?period=${month}`;
  if (id === "purchases") return `/purchases/invoices?month=${month}`;
  if (id.startsWith("op-") || id === "operating-total") return `/money/expenses?month=${month}`;
  return null;
}

/**
 * قائمةُ الدخل — «هل ربحتُ هذا الشهر؟» بما يُعرف وحده (`lib/income-sheet.ts`).
 *
 * المبيعاتُ ناقصةً المشترياتِ والمصروفات = الباقي على أساسٍ نقديّ. وكلُّ سطرٍ لا يُعرف
 * يُكتب «غير معروف» بسببه — لا صفر. والباقي لا يُحسب لشهرٍ ناقص.
 */
export default async function IncomeSheetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login?from=/close/pnl");
  if (!can(user.role, "month:close")) {
    return (
      <PageShell user={user} title="قائمة الدخل">
        <NoAccess what="قائمة الدخل" />
      </PageShell>
    );
  }

  const q = await searchParams;
  const current = currentMonthRiyadh();
  const month = q.month && MONTH_RE.test(q.month) && q.month <= current ? q.month : previousMonth(current);
  const recent: string[] = [];
  for (let m = current, i = 0; i < 6; i++, m = previousMonth(m)) recent.push(m);
  if (!recent.includes(month)) recent.push(month);

  const view = await loadIncomeSheet(month);
  const { sheet, revenue, foodics } = view;
  const remainder = sheet.remainderMinor;

  return (
    <PageShell
      user={user}
      title="قائمة الدخل"
      intro="المبيعاتُ ناقصةً المشترياتِ والمصروفات، شهراً شهراً — على أساسٍ نقديّ معلَن. ما لا يُعرف يُكتب «غير معروف» بسببه، والباقي لا يُحسب لشهرٍ ناقص."
    >
      <LinkTabs
        label="الشهر"
        items={recent.map((m) => ({ href: `/close/pnl?month=${m}`, label: formatMonth(m), active: m === month }))}
      />

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <KeyFigure
          icon={Scale}
          tone={remainder === null ? undefined : remainder < 0 ? "danger" : "ok"}
          label={`الباقي في ${formatMonth(month)} — على أساسٍ نقديّ`}
          value={remainder === null ? "غير معروف" : <Money minor={remainder} currency />}
          sub={remainder === null
            ? "لا يُحسب لشهرٍ ناقص — ما ينقصه أدناه."
            : remainder < 0 ? "خرج في المشتريات والمصروفات أكثر ممّا دخل مبيعاتٍ." : "ما بقي من المبيعات بعد المشتريات والمصروفات — وليس «الربح»: المخزونُ لم يُطرح."}
        >
          {sheet.blockers.length > 0 && (
            <ul className="mb-3 space-y-1.5 text-xs leading-relaxed text-ink-soft">
              {sheet.blockers.map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" strokeWidth={2} aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/close/vat?period=${month}#cash`} size="sm">اكتب نقدَ الشهر</LinkButton>
            <LinkButton href="/bank#import" size="sm" variant="quiet">استورد كشفاً</LinkButton>
          </div>
        </KeyFigure>

        <Card padded={false}>
          <ul className="divide-y divide-line-soft">
            {sheet.lines.map((l) => {
              const href = hrefOf(l.id, month);
              const strong = l.id === "cash-remainder" || l.id === "operating-total" || l.id === "sales";
              return (
                <li key={l.id} className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 ${l.id === "cash-remainder" ? "bg-sunken/60" : ""}`}>
                  <span className={`min-w-0 text-[13px] ${strong ? "font-bold" : l.id.startsWith("op-") ? "ps-3 text-ink-soft" : ""}`}>
                    {href ? <Link href={href} className="hover:underline">{l.label}</Link> : l.label}
                  </span>
                  {l.amountMinor === null ? (
                    <span className="text-end text-[11px] text-muted">
                      <span className="font-bold text-ink-soft">غير معروف</span>
                      {l.unavailableReason && <span className="block max-w-[22rem]">{l.unavailableReason}</span>}
                    </span>
                  ) : (
                    <span className={`text-sm ${strong ? "font-bold" : ""}`}><Money minor={l.amountMinor} signed={l.id === "cash-remainder"} /></span>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Section title="من أين جاءت الأرقام" icon={Info}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
          <Card href={`/close/vat?period=${month}`}>
            <p className="text-xs font-bold">المبيعات</p>
            {revenue ? (
              <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
                <Money minor={revenue.bankGrossMinor} /> وردت البنكَ وعُدّت بيعاً
                {revenue.cashGrossMinor === null ? "، ولم يُكتب نقدٌ" : <>، و<Money minor={revenue.cashGrossMinor} /> نقداً كتبتَه</>}
                {" "}— ناقصاً ضريبتَها <Money minor={revenue.outputVatMinor} />.
              </p>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-muted">غير معروفة: لا واردَ عُدّ بيعاً ولا نقدَ كُتب.</p>
            )}
          </Card>
          <Card href={`/purchases/invoices?month=${month}`}>
            <p className="text-xs font-bold">المشتريات</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {view.invoiceCount === 0 ? "لا فاتورةَ مقيَّدةً في هذا الشهر." : <>{countNoun(view.invoiceCount, INVOICE)} بشهرها المحاسبيّ، بلا ضريبتها حيث قُرئت.</>}
            </p>
          </Card>
          <Card href={`/money/expenses?month=${month}`}>
            <p className="text-xs font-bold">المصروفات</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
              {view.expenseCount === 0 ? "لا مصروفَ مقيَّداً في هذا الشهر." : "ما قُيِّد مصروفاً لهذا الشهر — سدادُ المورّدين ليس منه، فهو في المشتريات."}
            </p>
          </Card>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-xs">
          <span className="flex items-center gap-2 font-bold">
            <Scale className="h-4 w-4 text-muted" strokeWidth={1.75} aria-hidden />
            شاهدٌ من ملفّ فودكس
          </span>
          {foodics ? (
            <span className="text-ink-soft">
              مبيعاتُ الملفّ <span className="font-bold text-ink"><Money minor={foodics.salesMinor} /></span> وضريبتُها <Money minor={foodics.vatMinor} /> —
              يغطّي {countNoun(foodics.coveredDays, DAY)} من {foodics.expectedDays}. للمقابلة وحدها، لا يدخل الحساب.
            </span>
          ) : (
            <Badge tone="muted">لا ملفَّ فودكس لهذا الشهر</Badge>
          )}
        </div>
      </Section>

      <Callout tone="info" icon={Info} title="اقرأ الرقمَ بهذه القيود" className="mt-6">
        <ul className="list-disc space-y-1 ps-4">
          {sheet.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </Callout>
    </PageShell>
  );
}
