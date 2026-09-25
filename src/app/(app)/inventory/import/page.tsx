import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { BookOpen, FileSpreadsheet, History, Link2 } from "lucide-react";
import { db } from "@/db";
import { salesImports } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { PageShell } from "@/components/page-shell";
import { Badge, DataTable, EmptyState, LinkButton, NoAccess, Section, type Column, type Tone } from "@/components/ui";
import { InventoryImport } from "@/components/inventory-import";
import { CatalogImport } from "@/components/catalog-import";
import { RECIPE, SetupJourney, formatWeek } from "@/components/inventory-ui";
import { loadInventorySetup, setupProgress } from "@/services/inventory-overview.service";
import { PRODUCT, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
import { lastCompleteWeek, nextWeek } from "@/lib/inventory/week";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: Tone }> = {
  IMPORTED: { label: "كامل", tone: "ok" },
  PARTIAL: { label: "جزئيّ", tone: "warn" },
  FAILED: { label: "لم يُستورَد", tone: "danger" },
  DUPLICATE: { label: "مكرَّر", tone: "muted" },
  PENDING: { label: "لم يكتمل", tone: "warn" },
};

interface ImportRow {
  id: string;
  fileName: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  totalRows: number;
  importedRows: number;
  errorRows: number;
  createdAt: Date;
}

/**
 * الاستيراد — ملفّان يدخلان من هنا: الكتالوجُ مرّةً وعند تغيّره، ومبيعاتُ
 * الأسبوع كلَّ أحد.
 *
 * ── والترتيبُ يتبع الخطوة التالية ──
 *
 * بلا كتالوجٍ يُحسَب البيعُ بلا وصفة فيخرج الاستهلاكُ مجهولاً كلُّه. فمن لم
 * يرفع كتالوجاً بعد يرى الكتالوجَ أوّلاً، ومن رفعه يرى المبيعاتِ أوّلاً —
 * فعلَ كلِّ أحد.
 *
 * ── ولماذا سجلُّ الاستيرادات معروض ──
 *
 * «استوردتُ الملفّ» ليست «غُطّيت الفترة». والسجلُّ يقول أيّ فتراتٍ عندنا
 * وأيُّها لم يصل.
 */
export default async function SalesImportPage() {
  const user = await currentUser();
  if (!user) redirect("/login?from=/inventory/import");
  if (!can(user.role, "inventory:view")) {
    return (
      <PageShell user={user} width="page" title="الاستيراد">
        <NoAccess what="الجرد" />
      </PageShell>
    );
  }

  const [rows, setup] = await Promise.all([
    db.select({
      id: salesImports.id,
      fileName: salesImports.fileName,
      status: salesImports.status,
      periodStart: salesImports.periodStart,
      periodEnd: salesImports.periodEnd,
      totalRows: salesImports.totalRows,
      importedRows: salesImports.importedRows,
      errorRows: salesImports.errorRows,
      createdAt: salesImports.createdAt,
    })
      .from(salesImports)
      .orderBy(desc(salesImports.createdAt))
      .limit(30),
    loadInventorySetup(),
  ]);

  const progress = setupProgress(setup);
  const hasCatalog = progress.done.catalog;

  const columns: readonly Column<ImportRow>[] = [
    {
      key: "file", header: "الملفّ", primary: true,
      cell: (r) => <span className="font-bold" dir="auto">{r.fileName}</span>,
    },
    {
      key: "status", header: "الحال",
      cell: (r) => <Badge tone={STATUS[r.status]?.tone} dot>{STATUS[r.status]?.label ?? r.status}</Badge>,
    },
    {
      key: "period", header: "الفترة",
      cell: (r) => r.periodStart && r.periodEnd
        ? formatWeek(r.periodStart, r.periodEnd)
        : <span className="text-muted">غير مقروءة</span>,
    },
    {
      key: "rows", header: "الصفوف", numeric: true,
      cell: (r) => (
        <span className="nums">
          {r.importedRows} / {r.totalRows}
          {r.errorRows > 0 && <span className="text-danger"> · {r.errorRows} لم يُقرأ</span>}
        </span>
      ),
    },
    { key: "at", header: "رُفع في", secondary: true, cell: (r) => formatDay(r.createdAt) },
  ];

  return (
    <PageShell
      user={user}
      width="page"
      title="الاستيراد"
      intro="ملفّان يدخلان من هنا: كتالوجُ المقهى مرّةً وعند تغيّره، ومبيعاتُ الأسبوع كلَّ أحد — من فودكس كما هي."
      actions={setup.unmapped > 0
        ? <LinkButton href="/inventory/mapping" size="sm" icon={Link2}>{`${countNoun(setup.unmapped, PRODUCT)} تحتاج ربطاً`}</LinkButton>
        : undefined}
    >
      {!progress.complete ? (
        <section aria-label="خطوات البداية" className="mb-10">
          <SetupJourney facts={setup} countHref="/inventory#start" />
        </section>
      ) : (
        <p className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-raised px-4 py-3 text-xs text-ink-soft shadow-raised">
          <span className="flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5 text-muted" strokeWidth={2} aria-hidden />الكتالوج: <strong className="text-ink">{countNoun(setup.recipes, RECIPE)}</strong></span>
          <span className="flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5 text-muted" strokeWidth={2} aria-hidden />المبيعاتُ حتى <strong className="text-ink">{formatDay(setup.salesThrough)}</strong></span>
        </p>
      )}

      {/*
        الترتيبُ بـ`order` لا بموضعين في الشجرة: لو انتقل المكوّنُ من موضعٍ
        إلى آخر حين يُكتَب أوّلُ كتالوج لأعاد React تركيبَه، فتضيع نتيجةُ
        الاستيراد التي يعرضها — ويُكتَب الكتالوجُ ولا يُقال شيء.
      */}
      <div className="flex flex-col gap-10">
        <section id="sales" aria-labelledby="sales-title" className="scroll-mt-24">
          <SectionHead
            id="sales-title"
            n={2}
            icon={FileSpreadsheet}
            title="مبيعاتُ الأسبوع"
            hint="تصديرُ فودكس (Excel) كما هو — تقريرُ الطلبات أو مزيجُ الأصناف. منه وحده يُعرَف ما كان ينبغي أن يُصرَف."
          />
          <InventoryImport canImport={can(user.role, "inventory:count")} hasCatalog={hasCatalog} />
        </section>
        <section id="catalog" aria-labelledby="catalog-title" className={`scroll-mt-24 ${hasCatalog ? "" : "order-first"}`}>
          <SectionHead
            id="catalog-title"
            n={1}
            icon={BookOpen}
            title={hasCatalog ? "الكتالوج: الأصناف والعبوات والوصفات" : "ابدأ بالكتالوج: الأصناف والعبوات والوصفات"}
            hint={hasCatalog
              ? "ما يُباع، وما يُخزَّن، وكم يدخل كلَّ مشروب. ارفعه ثانيةً حين يتغيّر — وما كتبتَه بيدك لا يُكتَب فوقه."
              : "بلا وصفاتٍ لا يُعرَف ما استهلكته المبيعات — فهو الخطوةُ الأولى، ثمّ ملفُّ المبيعات."}
          />
          <CatalogImport
            canEdit={can(user.role, "recipe:edit")}
            defaultFrom={nextWeek(lastCompleteWeek()).start}
          />
        </section>
      </div>

      <Section title="ملفّاتُ المبيعات المستورَدة" icon={History} count={rows.length > 0 ? rows.length : undefined}>
        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(r) => r.id}
          searchOf={(r) => `${r.fileName} ${r.periodStart ?? ""} ${r.periodEnd ?? ""}`}
          searchLabel="ابحث باسم الملفّ أو التاريخ"
          empty={
            <EmptyState
              compact
              icon={FileSpreadsheet}
              title="لم يُستورَد ملفُّ مبيعاتٍ بعد."
              hint="يظهر هنا كلُّ ملفٍّ ترفعه، وأيُّ فترةٍ غطّاها، وما لم يُقرأ منه — فيُعرَف أيُّ الأسابيع عندنا وأيُّها لم يصل."
            />
          }
        />
      </Section>
    </PageShell>
  );
}

function SectionHead({
  id, n, icon: Icon, title, hint,
}: {
  id: string;
  n: number;
  icon: typeof BookOpen;
  title: string;
  hint: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        <span className="nums absolute -bottom-1 -start-1 grid h-5 w-5 place-items-center rounded-full border-2 border-surface bg-accent text-[10px] font-bold text-accent-ink">{n}</span>
      </span>
      <div className="min-w-0">
        <h2 id={id} className="text-base font-bold">{title}</h2>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted">{hint}</p>
      </div>
    </div>
  );
}
