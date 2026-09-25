import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { MailQuestion, MessageCircle } from "lucide-react";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { StatementQuickCheck, StatementReconcile } from "@/components/statement-reconcile";
import { Callout, Monogram, NoAccess, buttonClass } from "@/components/ui";
import { INVOICE, SUPPLIER, countNoun } from "@/lib/arabic";
import { previousMonth } from "@/lib/filing";
import { currentMonthRiyadh, formatDay, formatMonth } from "@/lib/riyadh-time";
import { buildStatementRequest } from "@/lib/supplier-requests";
import { loadMissingStatementSuppliers } from "@/services/supplier-followups.service";

export const dynamic = "force-dynamic";


/**
 * الكشوف — مقابلةُ كشف المورّد بفواتيرك، وهي وحدها تكشف الفاتورة التي
 * حمّلها عليك ولم تصلك.
 *
 * الترتيبُ بالعمل: ما أُرشف ولم يُطابَق أوّلاً، ثمّ كلُّ الكشوف في جدولٍ
 * يُبحث فيه. وبجانبها: فحصُ كشفٍ وصل الآن، ومن لم يصل كشفُه عن الشهر
 * المنقضي — بأسمائهم ورسالةِ طلبٍ جاهزة (كان لا يُرى إلّا بـ`?missing=1`،
 * والغائبُ لا يُرى في قائمة الواصل).
 */
export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ missing?: string; supplier?: string }>;
}) {
  const params = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?from=/statements");
  if (!can(user.role, "amounts:view")) {
    return (
      <PageShell user={user} width="wide" title="الكشوف">
        <NoAccess />
      </PageShell>
    );
  }

  /* الشهر نفسه الذي يعدّ به التنبيه: المنقضي بتوقيت الرياض */
  const missingMonth = previousMonth(currentMonthRiyadh());

  const [rows, missing, supplierRows] = await Promise.all([
    db.execute<{
      id: string; supplier_name: string | null; supplier_slug: string | null; ps: string; pe: string;
      closing: number | null; file_name: string | null; lines: number; matched: number;
    }>(sql`
      select st.id, s.name_ar as supplier_name, s.slug as supplier_slug,
             to_char(st.period_start, 'YYYY-MM-DD') as ps, to_char(st.period_end, 'YYYY-MM-DD') as pe,
             st.closing_balance_minor as closing, d.file_name,
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id) as lines,
             (select count(*)::int from statement_lines sl where sl.statement_id = st.id and sl.match_status = 'MATCHED') as matched
        from statements st
        left join suppliers s on s.id = st.supplier_id
        left join documents d on d.id = st.document_id
       /*
         «كشوفه» و«طابقها» في ملفّ المورّد تفتح كشوفه وحده (BTN-032) —
         فالمرشِّح بالمعرّف المختصر، ويُختار المورّد سلفاً في الفحص.
       */
       ${params.supplier ? sql`where s.slug = ${params.supplier}` : sql``}
       order by st.period_end desc
    `),
    loadMissingStatementSuppliers(missingMonth),
    db
      .select({ id: suppliers.id, nameAr: suppliers.nameAr, slug: suppliers.slug })
      .from(suppliers)
      .where(eq(suppliers.isActive, true))
      .orderBy(asc(suppliers.nameAr)),
  ]);

  const focusSupplier = params.supplier ? supplierRows.find((r) => r.slug === params.supplier) ?? null : null;
  const focusMissing = params.missing === "1";

  const missingPanel = (
    <section
      id="missing"
      aria-labelledby="missing-title"
      className={`scroll-mt-28 overflow-hidden rounded-xl border bg-raised shadow-raised ${focusMissing && missing.length > 0 ? "border-warn/40" : "border-line"}`}
    >
      <header className="border-b border-line-soft px-4 py-3.5 sm:px-5">
        <h2 id="missing-title" className="flex items-center gap-2 text-sm font-bold">
          <MailQuestion className={`h-4 w-4 ${missing.length > 0 ? "text-warn" : "text-ok"}`} strokeWidth={2} aria-hidden />
          {missing.length === 0
            ? `وصلت كشوف ${formatMonth(missingMonth)} كلُّها`
            : `لم يصل كشفُ ${formatMonth(missingMonth)} من ${countNoun(missing.length, SUPPLIER)}`}
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          {missing.length === 0
            ? "كلُّ مورّدٍ له فواتير عندنا وصل منه كشفٌ ينتهي في هذا الشهر."
            : "لهم فواتير عندنا ولا كشف منهم ينتهي في هذا الشهر. اطلبه، ثمّ ارفعه وطابقه."}
        </p>
      </header>
      {missing.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {missing.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <Monogram name={m.nameAr} />
              <span className="min-w-0 flex-1">
                <Link href={`/suppliers/${m.slug}`} className="block truncate text-[13px] font-bold hover:text-accent">{m.nameAr}</Link>
                <span className="block text-[11px] text-muted">
                  {countNoun(m.invoiceCount, INVOICE)}
                  {m.lastInvoiceDate && <> · آخرها {formatDay(m.lastInvoiceDate)}</>}
                </span>
              </span>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(buildStatementRequest(m.nameAr, missingMonth))}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`اطلب كشف ${m.nameAr} عبر واتساب`}
                title="اطلب الكشف (واتساب)"
                className={buttonClass("quiet", "sm")}
              >
                <MessageCircle className="h-4 w-4" strokeWidth={2} aria-hidden />
                اطلبه
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line-soft px-4 py-2.5 text-[11px] leading-relaxed text-muted sm:px-5">
        ومن لا يصدر كشوفاً يُعلَن ذلك في ملفّه («بياناته»)، فلا يُطلَب منه.
      </p>
    </section>
  );

  return (
    <PageShell
      user={user}
      width="wide"
      title="الكشوف"
      intro="مقابلةُ كشف المورّد بفواتيرك — وهي وحدها تكشف الفاتورة التي حمّلها عليك ولم تصلك، لأنّها ليست في أرشيفك."
    >
      {params.supplier && (
        <Callout
          tone="info"
          className="mb-6"
          action={<Link href="/statements" className={buttonClass("secondary", "sm")}>كشوف كلّ المورّدين</Link>}
        >
          {focusSupplier
            ? <>كشوف <strong className="text-ink">{focusSupplier.nameAr}</strong> وحده — وهو مختارٌ سلفاً في الفحص.</>
            : <>لا مورّد نشطاً بهذا المعرّف.</>}
        </Callout>
      )}

      {/* بندُ الطابور يفتح `?missing=1`: الغائبون أوّلاً، لا في ذيل العمود الجانبيّ */}
      {focusMissing && !params.supplier && <div className="mb-8 max-w-2xl">{missingPanel}</div>}

      <div className="grid gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <StatementReconcile
          archived={rows.rows.map((r) => ({
            id: r.id,
            supplierName: r.supplier_name ?? "—",
            supplierSlug: r.supplier_slug,
            periodStart: r.ps,
            periodEnd: r.pe,
            fileName: r.file_name ?? "",
            closingBalanceMinor: r.closing === null ? null : Number(r.closing),
            lineCount: Number(r.lines),
            matchedCount: Number(r.matched),
          }))}
        />
        <aside className="min-w-0 space-y-6">
          <StatementQuickCheck
            suppliers={supplierRows.map(({ id, nameAr }) => ({ id, nameAr }))}
            initialSupplierId={focusSupplier?.id}
          />
          {!params.supplier && !focusMissing && missingPanel}
        </aside>
      </div>
    </PageShell>
  );
}
