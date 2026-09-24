import { formatRiyalsDisplay } from "@/lib/money";
import Link from "next/link";
import { Badge, Card, EmptyState, Section, Stat, StatGrid, buttonClass } from "./ui";
import { Money, Prose } from "./money";
import { FinaliseCount, RecomputeCount, ReopenCount } from "./inventory-actions";
import { InventoryCountSteps, type StepRow } from "./inventory-count-steps";
import type { DuplicateRow, ReceiptRow } from "./inventory-flow-step";
import { InventoryWaste } from "./inventory-waste";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { canonicalToQuantity, formatSignedQuantity, milliToDecimal, unitChoices } from "@/lib/inventory/units";
import { formatBp } from "@/lib/inventory/equation";
import { describeCoverage, READINESS_LABEL } from "@/lib/inventory/coverage";
import {
  FLAG_LABEL, OPENING_SOURCE_LABEL, VALUATION_LABEL, topVariances, type EngineReport,
} from "@/lib/inventory/engine";
import type { CountHeader } from "@/services/inventory.service";

/**
 * ورشةُ الجرد — الشاشةُ التي يعمل فيها صاحبُ المقهى.
 *
 * الجاهزيّةُ فوق كلّ شيء — تُقرأ قبل أيّ رقم. ثمّ الخطواتُ الخمس بترتيب
 * العمل (`inventory-count-steps.tsx`): ما يُعَدّ ← ما دخل وما خرج ← ما
 * وُجد ← ما اختلف ← الإقفال.
 *
 * **ولا يُعرَض رقمُ فرقٍ يبدو دقيقاً فوق بياناتٍ ناقصة** بلا أن يُقال
 * ما نقص وكم يمثّل. فالتغطيةُ فوق الأرقام لا تحتها.
 */
export function InventoryWorkspace({
  header,
  report,
  canCount,
  canReopen,
  showAmounts,
  scopeInherited,
  receipts,
  duplicates,
  suppliers,
  manualOpenings,
  today,
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
  /** أمورَّثٌ نطاقُ هذا الجرد من سابقه؟ — يُقال للمستخدم. */
  scopeInherited: boolean;
  receipts: ReceiptRow[];
  duplicates: DuplicateRow[];
  suppliers: { id: string; name: string }[];
  manualOpenings: ReadonlyMap<string, { enteredMilli: number; unit: StoredUnit }>;
  today: string;
}) {
  const locked = header.status === "FINALISED";
  const coverage = report.coverage;
  const summary = report.totals.summary;

  const rows: StepRow[] = report.lines.map((l) => {
    const manual = manualOpenings.get(l.productId);
    return {
      productId: l.productId,
      productName: l.productName,
      category: l.category,
      categoryLabel: CATEGORY_LABEL[l.category as ProductCategory] ?? l.category,
      unitLabel: storedUnitLabel(l.baseUnit),
      baseUnit: l.baseUnit,
      unitChoices: unitChoices(l.baseUnit).map((u) => ({ value: u, label: storedUnitLabel(u) })),
      expected: q(l.theoreticalClosingMilli, l.baseUnit),
      actual: l.actualMilli === null ? "" : trim(canonicalToQuantity(l.actualMilli, l.baseUnit)),
      varianceText: l.varianceMilli === null ? null : formatSignedQuantity(l.varianceMilli, l.baseUnit),
      /* النسبةُ المعروضة هي نسبةُ الاستهلاك — جوابُ «كم ضاع ممّا صُرف» */
      varianceBpText: l.varianceConsumptionBp === null ? "نسبةٌ غير محسوبة" : formatBp(l.varianceConsumptionBp),
      varianceCostMinor: showAmounts ? l.varianceCostMinor : null,
      flags: l.flags.map((f) => FLAG_LABEL[f]),
      negative: (l.varianceMilli ?? 0) < 0,
      inScope: l.inScope,
      /* حدودُ المعادلة نصّاً — و`null` تبقى «غير معروف» لا صفراً */
      openingText: q(l.openingMilli, l.baseUnit),
      openingSourceLabel: OPENING_SOURCE_LABEL[l.openingSource],
      openingManual: l.openingSource === "MANUAL",
      openingEntered: manual ? milliToDecimal(manual.enteredMilli) : null,
      openingEnteredUnit: manual?.unit ?? null,
      purchasesText: q(l.purchasesMilli, l.baseUnit),
      purchasesZero: l.purchasesMilli === 0,
      manualReceiptsText: l.manualReceiptsMilli > 0 ? q(l.manualReceiptsMilli, l.baseUnit) : null,
      adjustmentsText: l.adjustmentsInMilli === 0 && l.adjustmentsOutMilli === 0
        ? null
        : q(l.adjustmentsInMilli - l.adjustmentsOutMilli, l.baseUnit),
      consumptionText: q(l.theoreticalConsumptionMilli, l.baseUnit),
      wasteText: l.recordedWasteMilli === 0 ? null : q(l.recordedWasteMilli, l.baseUnit),
    };
  });

  const inScopeCount = report.lines.filter((l) => l.inScope).length;
  const categories = [...new Set(report.lines.map((l) => l.category))].map((key) => ({
    key,
    label: CATEGORY_LABEL[key as ProductCategory] ?? key,
  }));

  /* والترتيبُ بالكلفة يبقى صحيحاً وإن لم تُعرَض — من يعدّ يرى الأثقل أوّلاً */
  const top = topVariances(report, 8);

  /* الاستلامُ يُقترَح في يومه إن وقع في الأسبوع، وإلّا آخرَ يومٍ فيه */
  const defaultReceiptDate = today >= header.periodStart && today <= header.periodEnd ? today : header.periodEnd;

  const measured = summary.linesMeasured > 0;

  /* ─────────── ‏٤ · ماذا اختلف؟ ─────────── */
  const review = (
    <div>
      {/*
        ── النقصُ والزيادةُ لا يتقاصّان ──

        نقصٌ بألفٍ وزيادةٌ بألف صافيهما صفر — وليس ذلك «لا مشكلة». فالنقصُ
        أوّلاً، والزيادةُ بجانبه، والصافي ثانويٌّ في آخر السطر.
      */}
      {/*
        بلا صنفٍ واحدٍ حُسب فرقُه فالمجاميعُ «غير معروفة» لا صفر: «النقص
        ٠٫٠٠» فوق «لا فرقَ محسوبٌ بعد» يقول «لم يضع شيء» عن أسبوعٍ لم يُقَس.
      */}
      <StatGrid>
        <Stat
          label="النقص"
          value={!measured ? "غير معروف" : showAmounts ? undefined : `${summary.linesShort} صنفاً`}
          minor={measured && showAmounts ? summary.shortageCostMinor : undefined}
          tone={summary.shortageCostMinor > 0 ? "danger" : undefined}
          sub={measured ? `${summary.linesShort} صنفاً وُجد منه أقلُّ من المتوقَّع` : "لم يُحسَب فرقُ صنفٍ بعد"}
        />
        <Stat
          label="الزيادة"
          value={!measured ? "غير معروف" : showAmounts ? undefined : `${summary.linesOver} صنفاً`}
          minor={measured && showAmounts ? summary.overageCostMinor : undefined}
          sub={measured ? `${summary.linesOver} صنفاً وُجد منه أكثر — شراءٌ لم يُقيَّد أو عدٌّ يُراجَع` : "لم يُحسَب فرقُ صنفٍ بعد"}
        />
        <Stat
          label="النقصُ من كلفة الاستهلاك"
          value={summary.shortageRateBp === null ? "غير محسوبة" : formatBp(-summary.shortageRateBp)}
          sub={summary.consumptionCostComplete ? "كم ضاع ممّا كان ينبغي أن يُصرَف" : "على ما عُرفت كلفتُه — المقامُ ناقص"}
        />
        {showAmounts ? (
          <Stat
            label="حجمُ الفروق"
            value={measured ? undefined : "غير معروف"}
            minor={measured ? summary.absoluteCostMinor : undefined}
            sub={measured
              ? `الصافي \u2066${formatRiyalsDisplay(summary.netCostMinor)}\u2069${summary.linesWithoutCost > 0 ? ` · ولا تشمل ${summary.linesWithoutCost} صنفاً كلفتُه غير معروفة` : ""}`
              : `${summary.linesMeasured} من ${inScopeCount} صنفاً حُسب فرقُه`}
          />
        ) : (
          <Stat label="أصنافٌ عُدّت" value={`${report.totals.linesCounted} من ${inScopeCount}`} />
        )}
      </StatGrid>

      {top.length === 0 ? (
        <Card className="mt-4">
          <p className="text-xs text-muted">
            لا فرقَ محسوبٌ بعد — يُحسَب لكلّ صنفٍ عُدّ وعُرفت حدودُ معادلته.
          </p>
        </Card>
      ) : (
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
                <Badge tone={(l.varianceMilli ?? 0) < 0 ? "danger" : "ok"}>
                  {(l.varianceMilli ?? 0) < 0 ? "نقص" : "زيادة"}
                </Badge>
                <span className={`nums text-xs font-bold ${(l.varianceMilli ?? 0) < 0 ? "text-danger" : "text-ok"}`}>
                  {formatSignedQuantity(l.varianceMilli, l.baseUnit)}
                </span>
                <span className="nums w-16 text-xs text-muted">{formatBp(l.varianceConsumptionBp)}</span>
                {showAmounts && (
                  <span className="nums w-24 text-end text-xs">
                    {l.varianceCostMinor === null ? "كلفةٌ غير معروفة" : <Money minor={l.varianceCostMinor} />}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">
            النسبةُ محسوبةٌ على <strong>الاستهلاك المتوقَّع</strong> — أي «كم ضاع ممّا كان
            ينبغي أن يُصرَف». {valuationNote(report)}
          </p>
        </Section>
      )}

      {/*
        ── ولماذا لا يُسمّى هذا «هدراً» ──

        الفرقُ قد يكون وصفةً خاطئة، أو جرعةً زائدة، أو ميزاناً غير معاير،
        أو شراءً لم يُقيَّد، أو نقلاً لم يُسجَّل. وتسميتُه هدراً دعوى سببٍ
        بلا دليل.
      */}
      <p className="mt-4 rounded-xl border border-line bg-sunken px-3 py-2.5 text-[11px] leading-relaxed text-ink-soft">
        هذا <strong>فرقُ جرد</strong> لا هدر: الفرقُ الواحد قد يكون جرعةً أكبر ممّا في الوصفة،
        أو ميزاناً غير معاير، أو كمّيّةً دخلت ولم تُقيَّد، أو نقلاً لم يُسجَّل، أو عدّاً
        مستعجلاً. راجِعها قبل أن تعدّه فاقداً — وما تعرف سببَه سجِّله هدراً فيخرج من هذا الرقم.
      </p>

      {!locked && inScopeCount > 0 && (
        <Section title="الهدر المسجَّل" hint="ما تعرف سببَه يخرج من «الفرق غير المفسَّر».">
          <InventoryWaste
            countId={header.id}
            branchId={header.branchId}
            defaultDate={header.periodEnd}
            items={report.lines.filter((l) => l.inScope).map((l) => ({
              id: l.productId,
              name: l.productName,
              baseUnit: l.baseUnit,
              unitLabel: storedUnitLabel(l.baseUnit),
            }))}
            canEdit={canCount}
          />
        </Section>
      )}
    </div>
  );

  /* ─────────── ‏٥ · الإقفال ─────────── */
  const finalise = locked ? (
    <div className="space-y-3">
      <Card tone="ok">
        <p className="text-xs leading-relaxed">
          أُقفل هذا الجرد{header.finalisedAt ? ` في ${header.finalisedAt.toISOString().slice(0, 10)}` : ""}.
          أرقامُه مجمَّدة، وأصولُها محفوظة — نسخُ الوصفات، وأسطرُ الفواتير، والكمّيّاتُ المستلَمة
          يدوياً، ومصادرُ الأرصدة الافتتاحيّة، ونطاقُ الجرد.
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
      totalItems={inScopeCount}
    />
  ) : null;

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
          <Fact label="أصنافٌ عُدّت" value={`${report.totals.linesCounted} من ${inScopeCount}`} />
        </dl>

        {/*
          ── النطاقُ يُقال ولا يُخفى ──

          «عُدّ ٢٤ من ٢٤» تقرأ اكتمالاً، وقد تكون ستّةٌ وثلاثون صنفاً
          خارج الجرد. وليس فجوةَ تغطية: هو اختيارُ إنسان معلَن، ولو أنقص
          الحكمَ لما بلغ جردٌ فيه استبعادٌ واحد `READY` أبداً.
        */}
        {coverage.scope.excluded > 0 && (
          <p className="mt-2.5 text-[11px] leading-relaxed text-ink-soft">
            و<span className="nums font-bold">{coverage.scope.excluded}</span> صنفاً خارج هذا الجرد
            باختيارك — وقائعُها محسوبة ولا فرقَ لها ولا تدخل المجاميع
            {coverage.scope.excludedNames.length > 0 && (
              <span className="text-muted">: {coverage.scope.excludedNames.join(" · ")}</span>
            )}.
          </p>
        )}

        {coverage.gaps.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {coverage.gaps.map((g, i) => (
              <li key={i} className="rounded-lg border border-line bg-raised/70 px-3 py-2 text-[11px] leading-relaxed">
                <span className="font-bold">{g.label}</span>
                <span className="nums text-muted"> — {g.count}</span>
                {/* «٣ منتجات» لا تقول شيئاً؛ وحصّتُها من المبيع تقول أيصلح التقرير */}
                {g.unitsShareBp !== null && g.unitsShareBp > 0 && (
                  <span className="nums font-bold"> · تمثّل {(g.unitsShareBp / 100).toFixed(1)}٪ من الوحدات المباعة</span>
                )}
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

      <Section id="count" title={locked ? "الجرد كما أُقفل" : "الجرد"}>
        {report.lines.length === 0 ? (
          <EmptyState
            title="لا صنفَ مخزونٍ مسجَّل بعد."
            hint="تُبنى الأصناف من كتالوج فودكس أو من بنود فواتير المورّدين."
            action={<Link href="/inventory/import" className={buttonClass("primary", "sm")}>ارفع كتالوج فودكس</Link>}
          />
        ) : (
          <InventoryCountSteps
            countId={header.id}
            branchId={header.branchId}
            periodStart={header.periodStart}
            periodEnd={header.periodEnd}
            defaultReceiptDate={defaultReceiptDate}
            rows={rows}
            categories={categories}
            receipts={receipts}
            duplicates={duplicates}
            suppliers={suppliers}
            canEdit={canCount}
            locked={locked}
            scopeInherited={scopeInherited}
            scopeExplicit={header.scopeSource === "EXPLICIT"}
            review={review}
            finalise={finalise}
          />
        )}
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

/**
 * أساسُ التقييم يُقال مع الرقم.
 *
 * والمنهجُ الذي يتغيّر بين تقريرين بلا إعلانٍ يُفسد المقارنة: أسبوعٌ
 * قُوِّم بمتوسّط شرائه وأسبوعٌ بآخر كلفةٍ معروفة ليسا على مقياسٍ واحد.
 */
function valuationNote(report: EngineReport): string {
  const bases = new Set(report.lines.filter((l) => l.varianceCostMinor !== null).map((l) => l.valuationBasis));
  if (bases.size === 0) return "";
  if (bases.size === 1) return VALUATION_LABEL[[...bases][0]] + ".";
  return "قُوِّم بعضُه بمتوسّط شراء الفترة وبعضُه بآخر كلفةٍ معروفة.";
}

/** رقمٌ بلا أصفارٍ زائدة — «٢» لا «٢٫٠٠٠». */
function trim(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** حدٌّ في المعادلة نصّاً — و`null` تبقى `null` فتُكتب «غير معروف». */
function q(milli: number | null, unit: StoredUnit): string | null {
  return milli === null ? null : trim(canonicalToQuantity(milli, unit));
}
