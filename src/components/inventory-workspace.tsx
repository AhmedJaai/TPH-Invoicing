import Link from "next/link";
import { Badge, Card, EmptyState, Section, Stat, StatGrid, buttonClass } from "./ui";
import { Money, Prose } from "./money";
import { FinaliseCount, RecomputeCount, ReopenCount } from "./inventory-actions";
import { InventoryCountEntry, type CountRow } from "./inventory-count-entry";
import { InventoryWaste } from "./inventory-waste";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { storedUnitLabel } from "@/lib/unit-conversion";
import { canonicalToQuantity, formatSignedQuantity } from "@/lib/inventory/units";
import { formatBp } from "@/lib/inventory/equation";
import { describeCoverage, READINESS_LABEL } from "@/lib/inventory/coverage";
import { FLAG_LABEL, topVariances, type EngineReport } from "@/lib/inventory/engine";
import type { CountHeader } from "@/services/inventory.service";

/**
 * ورشةُ الجرد — الشاشةُ التي يعمل فيها صاحبُ المقهى.
 *
 * والترتيب هو ترتيبُ العمل نفسِه، لا ترتيبُ الجداول:
 *
 *   الجاهزيّة → العدّ → الفرق → أكبرُ المشكلات → الإقفال
 *
 * **ولا يُعرَض رقمُ فرقٍ يبدو دقيقاً فوق بياناتٍ ناقصة** بلا أن يُقال
 * ما نقص وكم يمثّل. فالتغطيةُ فوق الأرقام لا تحتها، وهي أوّل ما يُقرأ.
 */
export function InventoryWorkspace({
  header,
  report,
  canCount,
  canReopen,
  showAmounts,
}: {
  header: CountHeader;
  report: EngineReport;
  canCount: boolean;
  canReopen: boolean;
  /**
   * أيرى هذا الدورُ المبالغ؟
   *
   * مديرُ المشتريات يعدّ الرفَّ ولا يرى كلفةَ الفرق — فهو يقف عند
   * الميزان لا عند الدفتر. و`inventory:count` صلاحيةُ عدٍّ لا صلاحيةُ
   * اطّلاعٍ على المال، فلا تُفتَح بها الأرقامُ المالية من باب خلفيّ.
   */
  showAmounts: boolean;
}) {
  const locked = header.status === "FINALISED";
  const coverage = report.coverage;

  const rows: CountRow[] = report.lines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    category: l.category,
    categoryLabel: CATEGORY_LABEL[l.category as ProductCategory] ?? l.category,
    unitLabel: storedUnitLabel(l.baseUnit),
    expected: l.theoreticalClosingMilli === null
      ? null
      : trim(canonicalToQuantity(l.theoreticalClosingMilli, l.baseUnit)),
    actual: l.actualMilli === null ? "" : trim(canonicalToQuantity(l.actualMilli, l.baseUnit)),
    varianceText: l.varianceMilli === null ? null : formatSignedQuantity(l.varianceMilli, l.baseUnit),
    varianceBpText: l.varianceBp === null ? "نسبةٌ غير محسوبة" : formatBp(l.varianceBp),
    varianceCostMinor: showAmounts ? l.varianceCostMinor : null,
    flags: l.flags.map((f) => FLAG_LABEL[f]),
    negative: (l.varianceMilli ?? 0) < 0,
  }));

  const categories = [...new Set(report.lines.map((l) => l.category))].map((key) => ({
    key,
    label: CATEGORY_LABEL[key as ProductCategory] ?? key,
  }));

  /* والترتيبُ بالكلفة يبقى صحيحاً وإن لم تُعرَض — من يعدّ يرى الأثقل أوّلاً */
  const top = topVariances(report, 5);
  const withKnownCost = report.totals.linesWithKnownCost;
  const missingCost = report.totals.linesWithVariance - withKnownCost;

  return (
    <>
      {/* ── الجاهزيّة: تُقرأ قبل أيّ رقم ── */}
      <div className={`rounded-2xl border p-4 sm:p-5 ${
        coverage.readiness === "READY" ? "border-ok/40 bg-ok-bg"
          : coverage.readiness === "BLOCKED" ? "border-danger/40 bg-danger-bg"
            : "border-warn/40 bg-warn-bg"
      }`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={coverage.readiness === "READY" ? "ok" : coverage.readiness === "BLOCKED" ? "danger" : "warn"}>
            {READINESS_LABEL[coverage.readiness]}
          </Badge>
          <span className="nums text-xs text-muted">
            {header.periodStart} → {header.periodEnd}
          </span>
          {header.branchName && <span className="text-xs text-muted">· {header.branchName}</span>}
          {locked && <Badge>مقفَل</Badge>}
          {header.reopenCount > 0 && <Badge tone="warn">أُعيد فتحُه {header.reopenCount} مرّة</Badge>}
        </div>

        <p className="mt-2.5 text-sm leading-relaxed">
          <Prose text={describeCoverage(coverage)} />
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
          <Fact label="أسطرُ بيع" value={`${coverage.sales.includedLines} من ${coverage.sales.lines}`} />
          <Fact label="أيّامٌ فيها مبيعات" value={`${coverage.sales.daysWithSales} من ${coverage.sales.periodDays}`} />
          <Fact label="أسطرُ شراء" value={`${coverage.purchases.includedLines} من ${coverage.purchases.lines}`} />
          <Fact label="أصنافٌ عُدّت" value={`${report.totals.linesCounted} من ${report.lines.length}`} />
        </dl>

        {coverage.gaps.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {coverage.gaps.map((g, i) => (
              <li key={i} className="rounded-lg border border-line bg-raised/70 px-3 py-2 text-[11px] leading-relaxed">
                <span className="font-bold">{g.label}</span>
                <span className="nums text-muted"> — {g.count}</span>
                {showAmounts && g.totalMinor > 0 && <> بقيمة <Money minor={g.totalMinor} /></>}
                {g.examples.length > 0 && <span className="text-muted"> · {g.examples.join(" · ")}</span>}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {!locked && canCount && <RecomputeCount countId={header.id} />}
          <Link href="/inventory/import" className={buttonClass("secondary", "sm")}>
            استورِد مبيعات فودكس
          </Link>
          <Link href="/inventory/mapping" className={buttonClass("secondary", "sm")}>
            اربط منتجات فودكس
          </Link>
        </div>
      </div>

      {/* ── الأرقام ── */}
      {showAmounts && (
        <StatGrid>
          <Stat label="مبيعاتُ الفترة" minor={coverage.sales.includedTotalMinor} />
          <Stat label="مشترياتُ الفترة" minor={report.totals.purchasesTotalMinor} />
          <Stat
            label="كلفةُ فرق الجرد"
            minor={report.totals.varianceCostMinor}
            tone={report.totals.varianceCostMinor < 0 ? "danger" : undefined}
            sub={
              missingCost > 0
                ? `لا تشمل ${missingCost} صنفاً كلفتُها غير معروفة`
                : "على ما عُرفت كلفتُه"
            }
          />
          <Stat
            label="نسبةُ الفرق من المبيعات"
            value={
              coverage.sales.includedTotalMinor > 0
                ? formatBp(Math.round((report.totals.varianceCostMinor * 10_000) / coverage.sales.includedTotalMinor))
                : "غير معروف"
            }
          />
        </StatGrid>
      )}

      {/* ── أكبرُ الفروق ── */}
      {top.length > 0 && (
        <Section
          title="أكبرُ الفروق"
          hint="مرتَّبةٌ بالكلفة لا بالكمّيّة — كيلو بنٍّ أثقل من لترِ حليبٍ بأضعاف، والعين لا تقرأ ذلك من الكمّيّتين."
        >
          <ul className="divide-y divide-line rounded-2xl border border-line bg-raised">
            {top.map((l) => (
              <li key={l.productId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <Link href={`/inventory/items/${l.productId}`} className="min-w-0 flex-1 text-xs font-bold hover:underline">
                  {l.productName}
                </Link>
                <span className={`nums text-xs font-bold ${(l.varianceMilli ?? 0) < 0 ? "text-danger" : "text-ok"}`}>
                  {formatSignedQuantity(l.varianceMilli, l.baseUnit)}
                </span>
                <span className="nums w-16 text-xs text-muted">{formatBp(l.varianceBp)}</span>
                {showAmounts && (
                  <span className="nums w-24 text-end text-xs">
                    {l.varianceCostMinor === null ? "كلفةٌ غير معروفة" : <Money minor={l.varianceCostMinor} />}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {/*
            ── ولماذا لا يُسمّى هذا «فاقداً» ──

            النصُّ ثابتٌ محسوبٌ لا مولَّد: الفرقُ قد يكون وصفةً خاطئة، أو
            جرعةً زائدة، أو ميزاناً غير معاير، أو شراءً لم يُقيَّد، أو
            نقلاً لم يُسجَّل. وتسميتُه «فاقداً» دعوى سببٍ بلا دليل.
          */}
          <p className="mt-3 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
            هذا <strong>فرقُ جرد</strong> لا فاقد: الفرقُ الواحد قد يكون جرعةً أكبر ممّا في
            الوصفة، أو ميزاناً غير معاير، أو فاتورةَ شراءٍ لم تصل بعد، أو نقلاً لم يُسجَّل،
            أو عدّاً مستعجلاً. راجِع هذه قبل أن تعدّه فاقداً — وما تعرف سببَه سجِّله هدراً
            فيخرج من هذا الرقم.
          </p>
        </Section>
      )}

      {/* ── العدّ ── */}
      <Section
        id="count"
        title={locked ? "الأصناف كما أُقفلت" : "أدخِل العدّ الفعليّ"}
        hint={locked
          ? "هذه الأرقام مجمَّدة — لا تتغيّر بتعديل وصفةٍ ولا بوصول فاتورة."
          : "اكتب ما وجدتَه على الرفّ، والباقي محسوب. وEnter ينقلك إلى الصنف التالي."}
      >
        {report.lines.length === 0 ? (
          <EmptyState
            title="لا صنفَ مخزونٍ مسجَّل بعد."
            hint="تُبنى الأصناف من بنود فواتير المورّدين — ارفع فاتورةً أو اربط أصنافَ مورّديك."
          />
        ) : (
          <InventoryCountEntry
            countId={header.id}
            rows={rows}
            categories={categories}
            canEdit={canCount}
            locked={locked}
          />
        )}
      </Section>

      {/* ── الهدر: فعلٌ داخل الجرد لا مساحةٌ تُزار ── */}
      {!locked && report.lines.length > 0 && (
        <Section title="الهدر المسجَّل" hint="ما تعرف سببَه يخرج من «الفرق غير المفسَّر».">
          <InventoryWaste
            countId={header.id}
            branchId={header.branchId}
            defaultDate={header.periodEnd}
            items={report.lines.map((l) => ({
              id: l.productId,
              name: l.productName,
              baseUnit: l.baseUnit,
              unitLabel: storedUnitLabel(l.baseUnit),
            }))}
            canEdit={canCount}
          />
        </Section>
      )}

      {/* ── الإقفال أو إعادة الفتح ── */}
      <Section title={locked ? "حالُ هذا الجرد" : "إقفال الجرد"}>
        {locked ? (
          <div className="space-y-3">
            <Card tone="ok">
              <p className="text-xs leading-relaxed">
                أُقفل هذا الجرد{header.finalisedAt ? ` في ${header.finalisedAt.toISOString().slice(0, 10)}` : ""}.
                أرقامُه مجمَّدة، وأصولُها محفوظة — نسخُ الوصفات التي حَكَمت، وأسطرُ الفواتير
                التي حُسبت منها الكمّيّات.
              </p>
            </Card>
            {canReopen && <ReopenCount countId={header.id} />}
          </div>
        ) : coverage.readiness === "BLOCKED" ? (
          <Card tone="warn">
            <p className="text-xs leading-relaxed">
              لا يُقفَل جردٌ لا يُحسَب: استورِد مبيعات الفترة واربط أصنافها أوّلاً.
            </p>
          </Card>
        ) : canCount ? (
          <FinaliseCount
            countId={header.id}
            readiness={coverage.readiness}
            countedItems={report.totals.linesCounted}
            totalItems={report.lines.length}
          />
        ) : null}
      </Section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="nums text-sm font-bold">{value}</dd>
    </div>
  );
}

/** رقمٌ بلا أصفارٍ زائدة — «٢» لا «٢٫٠٠٠». */
function trim(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
