import Link from "next/link";
import {
  ArrowLeft, CircleCheck, FileSpreadsheet, Link2, Lock, OctagonAlert, Package, ShieldCheck, TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { formatRiyalsDisplay } from "@/lib/money";
import { Badge, Callout, EmptyState, LinkButton, Meter, Section, type Tone } from "./ui";
import { Money, Prose } from "./money";
import { FinaliseCount, RecomputeCount, ReopenCount } from "./inventory-actions";
import { InventoryCountSteps, type StepRow } from "./inventory-count-steps";
import type { DuplicateRow, ReceiptRow } from "./inventory-flow-step";
import { InventoryWaste } from "./inventory-waste";
import { DIRECTION, DirectionTag, MagnitudeBar, VarianceSplit, directionOf, formatWeek, type StepId } from "./inventory-ui";
import { CATEGORY_LABEL, type ProductCategory } from "@/lib/products";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { canonicalToQuantity, formatSignedQuantity, milliToDecimal, unitChoices } from "@/lib/inventory/units";
import { formatBp } from "@/lib/inventory/equation";
import { describeCoverage, READINESS_LABEL, type CoverageGap, type Readiness } from "@/lib/inventory/coverage";
import {
  FLAG_LABEL, OPENING_SOURCE_LABEL, VALUATION_LABEL, topVariances, type EngineReport,
} from "@/lib/inventory/engine";
import { LINE, PRODUCT, countNoun } from "@/lib/arabic";
import { formatDay } from "@/lib/riyadh-time";
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
  initialStep,
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
  /** خطوةٌ مطلوبة في العنوان (`?step=count`) — فالرابطُ يفتح موضعَه. */
  initialStep?: StepId | null;
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
      direction: directionOf(l.varianceMilli),
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
  const measured = summary.linesMeasured > 0;

  /* الاستلامُ يُقترَح في يومه إن وقع في الأسبوع، وإلّا آخرَ يومٍ فيه */
  const defaultReceiptDate = today >= header.periodStart && today <= header.periodEnd ? today : header.periodEnd;

  /* ─────────── ‏٤ · ماذا اختلف؟ ─────────── */
  const maxWeight = Math.max(
    1,
    ...top.map((l) => (l.varianceCostMinor !== null ? Math.abs(l.varianceCostMinor) : 0)),
  );
  const maxBp = Math.max(1, ...top.map((l) => Math.abs(l.varianceConsumptionBp ?? 0)));
  const anyCost = top.some((l) => l.varianceCostMinor !== null);

  const review = (
    <div className="space-y-8">
      {/*
        ── النقصُ والزيادةُ لا يتقاصّان ──

        نقصٌ بألفٍ وزيادةٌ بألف صافيهما صفر — وليس ذلك «لا مشكلة». فهما
        لوحان متجاوران، والصافي سطرٌ ثانويٌّ تحتهما. وبلا صنفٍ واحدٍ حُسب
        فرقُه فالمجموعان «غير معروفين» لا صفر.
      */}
      <VarianceSplit
        shortage={summary.shortageCostMinor}
        overage={summary.overageCostMinor}
        linesShort={summary.linesShort}
        linesOver={summary.linesOver}
        showAmounts={showAmounts}
        measured={measured}
        foot={measured ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Mini
              label="النقصُ من كلفة الاستهلاك"
              value={summary.shortageRateBp === null ? "غير محسوبة" : formatBp(-summary.shortageRateBp)}
              hint={summary.consumptionCostComplete ? "كم ضاع ممّا كان ينبغي أن يُصرَف" : "على ما عُرفت كلفتُه — المقامُ ناقص"}
            />
            {showAmounts && (
              <Mini
                label="حجمُ الفروق"
                value={<Money minor={summary.absoluteCostMinor} />}
                hint={`نقصٌ وزيادةٌ معاً · والصافي ⁦${formatRiyalsDisplay(summary.netCostMinor)}⁩`}
              />
            )}
            <Mini
              label="أصنافٌ حُسب فرقُها"
              value={<span className="nums">{summary.linesMeasured} من {inScopeCount}</span>}
              hint={summary.linesWithoutCost > 0 ? `منها ${countNoun(summary.linesWithoutCost, PRODUCT)} كلفتُه غير معروفة` : "كلُّها معروفةُ الكلفة"}
            />
          </dl>
        ) : undefined}
      />

      <Section
        title="أكبرُ الفروق"
        className="mt-0!"
        hint={anyCost ? "مرتَّبةٌ بالكلفة لا بالكمّيّة — كيلو بنٍّ أثقل من لترِ حليبٍ بأضعاف، والعين لا تقرأ ذلك من الكمّيّتين." : undefined}
      >
        {top.length === 0 ? (
          <EmptyState
            compact
            icon={Package}
            title={measured ? "لا فرقَ في ما عُدّ — كلُّه مطابق." : "لم يُحسَب فرقٌ بعد."}
            hint={measured
              ? "كلُّ صنفٍ عُدّ وُجد منه ما كان متوقَّعاً."
              : "يُحسَب لكلّ صنفٍ عُدّ وعُرفت حدودُ معادلته — أدخِل ما وجدتَه في الخطوة الثالثة."}
          />
        ) : (
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
            {top.map((l) => {
              const d = directionOf(l.varianceMilli) ?? "even";
              const weight = anyCost && l.varianceCostMinor !== null ? Math.abs(l.varianceCostMinor) : Math.abs(l.varianceConsumptionBp ?? 0);
              return (
                <li key={l.productId} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Link href={`/inventory/items/${l.productId}`} className="min-w-0 flex-1 truncate text-[13px] font-bold hover:text-accent hover:underline hover:underline-offset-4">
                      {l.productName}
                    </Link>
                    <DirectionTag milli={l.varianceMilli} />
                    <span className={`nums text-[13px] font-bold ${DIRECTION[d].text}`}>
                      {formatSignedQuantity(l.varianceMilli, l.baseUnit)}
                    </span>
                    <span className="nums w-16 text-end text-xs text-muted">{formatBp(l.varianceConsumptionBp)}</span>
                    {showAmounts && (
                      <span className="w-24 text-end text-[13px]">
                        {l.varianceCostMinor === null ? <span className="text-[11px] text-muted">كلفةٌ غير معروفة</span> : <Money minor={Math.abs(l.varianceCostMinor)} />}
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <MagnitudeBar value={weight} max={anyCost ? maxWeight : maxBp} direction={d} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {top.length > 0 && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            النسبةُ على <strong>الاستهلاك المتوقَّع</strong> — «كم ضاع ممّا كان ينبغي أن يُصرَف». {valuationNote(report)}
          </p>
        )}
      </Section>

      {/*
        ── ولماذا لا يُسمّى هذا «هدراً» ──

        الفرقُ قد يكون وصفةً خاطئة، أو جرعةً زائدة، أو ميزاناً غير معاير،
        أو شراءً لم يُقيَّد، أو نقلاً لم يُسجَّل. وتسميتُه هدراً دعوى سببٍ
        بلا دليل.
      */}
      <Callout tone="muted" icon={ShieldCheck} title="هذا فرقُ جرد، لا هدر">
        الفرقُ الواحد قد يكون جرعةً أكبر ممّا في الوصفة، أو ميزاناً غير معاير، أو كمّيّةً دخلت ولم تُقيَّد،
        أو نقلاً لم يُسجَّل، أو عدّاً مستعجلاً. راجِعه قبل أن تعدّه فاقداً — وما تعرف سببَه سجِّله هدراً
        أدناه فيخرج من «الفرق غير المفسَّر».
      </Callout>

      {!locked && inScopeCount > 0 && canCount && (
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
      )}
    </div>
  );

  /* ─────────── ‏٥ · الإقفال ─────────── */
  const uncounted = inScopeCount - report.totals.linesCounted;
  const checks: { ok: boolean; warn?: boolean; text: string }[] = [
    {
      ok: coverage.readiness === "READY",
      warn: coverage.readiness === "PARTIAL",
      text: coverage.readiness === "READY"
        ? "كلُّ ما بِيع مربوطٌ وله وصفةٌ سارية."
        : coverage.readiness === "PARTIAL" ? "التقريرُ جزئيّ — وما نقص مكتوبٌ فيه." : "لا مبيعاتَ داخلةٌ في الحساب — لا يُقفَل.",
    },
    {
      ok: uncounted === 0 && inScopeCount > 0,
      warn: uncounted > 0,
      text: uncounted === 0
        ? `عُدّت الأصنافُ كلُّها (${countNoun(inScopeCount, PRODUCT)}).`
        : `${countNoun(uncounted, PRODUCT)} بلا عدّ — يُقفَل بلا فرقٍ محسوب.`,
    },
    {
      ok: duplicates.length === 0,
      warn: duplicates.length > 0,
      text: duplicates.length === 0
        ? "لا استلامَ يدويّاً يشبه بندَ فاتورة."
        : `${countNoun(duplicates.length, LINE)} استلامٍ قد يكون مكرَّراً — المشترياتُ غير معروفة حتى تُحسَم.`,
    },
  ];

  const finalise = locked ? (
    <div className="space-y-4">
      <Callout tone="ok" icon={Lock} title={`أُقفل هذا الجرد${header.finalisedAt ? ` في ${formatDay(header.finalisedAt)}` : ""}`}>
        أرقامُه مجمَّدة، وأصولُها محفوظة — نسخُ الوصفات، وأسطرُ الفواتير، والكمّيّاتُ المستلَمة يدوياً،
        ومصادرُ الأرصدة الافتتاحيّة، ونطاقُ الجرد. ولا تغيّره وصفةٌ تُعدَّل بعده ولا فاتورةٌ تصل.
      </Callout>
      {canReopen && <ReopenCount countId={header.id} />}
    </div>
  ) : (
    <div className="space-y-4">
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {checks.map((c) => (
          <li key={c.text} className="flex items-start gap-3 px-4 py-3 text-[13px] leading-relaxed">
            {c.ok
              ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" strokeWidth={2} aria-label="سليم" />
              : c.warn
                ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-label="تنبيه" />
                : <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={2} aria-label="مانع" />}
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
      {coverage.readiness === "BLOCKED" ? (
        <Callout
          tone="warn"
          icon={TriangleAlert}
          title="لا يُقفَل جردٌ لا يُحسَب"
          action={<LinkButton href="/inventory/import#sales" variant="primary" size="sm" icon={FileSpreadsheet}>استورِد المبيعات</LinkButton>}
        >
          استورِد مبيعاتِ الفترة واربط أصنافَها أوّلاً — ثمّ أعِد الحساب.
        </Callout>
      ) : canCount ? (
        <FinaliseCount
          countId={header.id}
          readiness={coverage.readiness}
          countedItems={report.totals.linesCounted}
          totalItems={inScopeCount}
        />
      ) : (
        <p className="text-xs text-muted">الإقفالُ خارج صلاحيتك.</p>
      )}
    </div>
  );

  return (
    <>
      <CoverageBanner
        header={header}
        report={report}
        inScopeCount={inScopeCount}
        showAmounts={showAmounts}
        canCount={canCount}
        locked={locked}
      />

      <div className="mt-8">
        {report.lines.length === 0 ? (
          <EmptyState
            icon={Package}
            title="لا صنفَ مخزونٍ مسجَّل بعد."
            hint="تُبنى الأصناف من كتالوج فودكس أو من بنود فواتير المورّدين — وبعدها يُعَدّ هنا."
            action={<LinkButton href="/inventory/import#catalog" variant="primary" size="sm">ارفع كتالوج فودكس</LinkButton>}
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
            measured={measured}
            initialStep={initialStep ?? null}
            review={review}
            finalise={finalise}
          />
        )}
      </div>
    </>
  );
}

/* ─────────────────────── رأسُ الجرد: الجاهزيّة ─────────────────────── */

const READINESS_SKIN: Record<Readiness, { tone: Tone; icon: LucideIcon; stripe: string }> = {
  READY: { tone: "ok", icon: CircleCheck, stripe: "bg-ok" },
  PARTIAL: { tone: "warn", icon: TriangleAlert, stripe: "bg-warn" },
  BLOCKED: { tone: "danger", icon: OctagonAlert, stripe: "bg-danger" },
};

/**
 * الجاهزيّةُ تُقرأ قبل أيّ رقم — حكمٌ، وجملةٌ، وأربعةُ مقاييس، وفجواتٌ بأفعالها.
 */
function CoverageBanner({
  header, report, inScopeCount, showAmounts, canCount, locked,
}: {
  header: CountHeader;
  report: EngineReport;
  inScopeCount: number;
  showAmounts: boolean;
  canCount: boolean;
  locked: boolean;
}) {
  const coverage = report.coverage;
  const skin = READINESS_SKIN[coverage.readiness];
  const noSales = coverage.sales.lines === 0;

  const meters: { label: string; value: number; max: number; empty?: string }[] = [
    { label: "أسطرُ بيعٍ دخلت الحساب", value: coverage.sales.includedLines, max: coverage.sales.lines, empty: "لا مبيعاتٍ مستورَدة" },
    { label: "أيّامٌ فيها مبيعات", value: coverage.sales.daysWithSales, max: coverage.sales.periodDays },
    { label: "أسطرُ شراءٍ عُرفت كمّيّتُها", value: coverage.purchases.includedLines, max: coverage.purchases.lines, empty: "لا فواتيرَ في الفترة" },
    { label: "أصنافٌ عُدّت", value: report.totals.linesCounted, max: inScopeCount },
  ];

  return (
    <section aria-labelledby="coverage-title" className="relative overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
      <span aria-hidden className={`absolute inset-y-0 start-0 w-1 ${skin.stripe}`} />
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="coverage-title" className="sr-only">جاهزيّةُ الحساب</h2>
          <Badge tone={skin.tone} dot>{`الحساب ${READINESS_LABEL[coverage.readiness]}`}</Badge>
          {locked ? <Badge dot>مقفَل</Badge> : <Badge tone="accent" dot>مسوّدة</Badge>}
          {header.reopenCount > 0 && <Badge tone="warn">أُعيد فتحُه {header.reopenCount === 1 ? "مرّة" : `${header.reopenCount} مرّات`}</Badge>}
          <span className="text-xs text-muted">أسبوع {formatWeek(header.periodStart, header.periodEnd)}{header.branchName ? ` · ${header.branchName}` : ""}</span>
        </div>

        <p className="mt-3 flex items-start gap-2 text-[15px] font-bold leading-relaxed">
          <skin.icon className={`mt-1 h-[18px] w-[18px] shrink-0 ${skin.tone === "ok" ? "text-ok" : skin.tone === "warn" ? "text-warn" : "text-danger"}`} strokeWidth={2} aria-hidden />
          <span><Prose text={describeCoverage(coverage)} /></span>
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-4">
          {meters.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="truncate text-[11px] font-medium text-muted">{m.label}</dt>
              <dd className="mt-1">
                {m.max === 0 ? (
                  <span className="text-[13px] font-bold text-muted">{m.empty ?? "لا شيء بعد"}</span>
                ) : (
                  <>
                    <span className="text-[13px] font-bold"><span className="nums">{m.value}</span> <span className="text-muted">من</span> <span className="nums">{m.max}</span></span>
                    <span className="mt-1.5 block">
                      <Meter value={m.value} max={m.max} tone={m.value === m.max ? "ok" : "accent"} label={m.label} />
                    </span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>

        {/*
          ── النطاقُ يُقال ولا يُخفى ──

          «عُدّ ٢٤ من ٢٤» تقرأ اكتمالاً، وقد تكون ستّةٌ وثلاثون صنفاً
          خارج الجرد. وليس فجوةَ تغطية: هو اختيارُ إنسان معلَن.
        */}
        {coverage.scope.excluded > 0 && (
          <p className="mt-4 text-xs leading-relaxed text-ink-soft">
            و<span className="font-bold">{countNoun(coverage.scope.excluded, PRODUCT)}</span> خارج هذا الجرد باختيارك — وقائعُها
            محسوبة ولا فرقَ لها ولا تدخل المجاميع
            {coverage.scope.excludedNames.length > 0 && <span className="text-muted">: {coverage.scope.excludedNames.join(" · ")}</span>}.
          </p>
        )}
      </div>

      {coverage.gaps.length > 0 && (
        <ul className="divide-y divide-line-soft border-t border-line bg-sunken/40">
          {coverage.gaps.map((g, i) => {
            const fix = gapAction(g);
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1 text-xs leading-relaxed">
                  <p className="font-bold text-ink">
                    {g.label} <span className="nums text-muted">· {g.count}</span>
                    {/* «٣ منتجات» لا تقول شيئاً؛ وحصّتُها من المبيع تقول أيصلح التقرير */}
                    {g.unitsShareBp !== null && g.unitsShareBp > 0 && (
                      <span className="text-warn"> · تمثّل <span className="nums">{(g.unitsShareBp / 100).toFixed(1)}٪</span> من الوحدات المباعة</span>
                    )}
                    {showAmounts && g.totalMinor > 0 && <span className="font-medium text-muted"> · بقيمة <Money minor={g.totalMinor} /></span>}
                  </p>
                  {g.examples.length > 0 && <p className="mt-0.5 truncate text-muted">{g.examples.join(" · ")}</p>}
                </div>
                {fix && (
                  <Link href={fix.href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-bold text-accent hover:underline hover:underline-offset-4 sm:min-h-0">
                    {fix.label} <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!locked && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
          {noSales ? (
            <LinkButton href="/inventory/import#sales" variant="primary" size="sm" icon={FileSpreadsheet}>استورِد مبيعات الأسبوع</LinkButton>
          ) : (
            <LinkButton href="/inventory/import#sales" size="sm" icon={FileSpreadsheet}>استورِد مبيعاتٍ أحدث</LinkButton>
          )}
          {coverage.gaps.some((g) => g.reason === "UNMAPPED_POS_PRODUCT") && (
            <LinkButton href="/inventory/mapping" size="sm" icon={Link2}>اربط منتجات فودكس</LinkButton>
          )}
          {canCount && <RecomputeCount countId={header.id} />}
          <span className="text-[11px] text-muted">بعد استيرادٍ أو تصحيحِ وصفة، أعِد الحساب.</span>
        </div>
      )}
    </section>
  );
}

/** فعلُ كلّ فجوة — العددُ الذي يُنذر يحمل ما يُصلحه. */
function gapAction(g: CoverageGap): { href: string; label: string } | null {
  switch (g.reason) {
    case "UNMAPPED_POS_PRODUCT":
      return { href: "/inventory/mapping", label: "اربطها" };
    case "NO_RECIPE":
    case "NO_EFFECTIVE_VERSION":
    case "EMPTY_RECIPE":
    case "UNSUPPORTED_YIELD_UNIT":
    case "UNIT_CONFLICT":
    case "NO_UNIT":
      return { href: "/inventory/recipes", label: "الوصفات" };
    case "UNLINKED_PRODUCT":
    case "NO_PACK_SPEC":
    case "UNIT_FAMILY_MISMATCH":
      return { href: "/purchases/products", label: "الأصنافُ والعبوات" };
    case "MISSING_QUANTITY":
      return { href: "/purchases/invoices", label: "الفواتير" };
    case "RECEIPT_AMBIGUOUS":
    case "RECEIPT_POSSIBLE_DUPLICATE":
      return { href: "?step=flow", label: "احسمها في الخطوة الثانية" };
    default:
      return null;
  }
}

function Mini({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-raised px-4 py-3">
      <dt className="text-[11px] font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-base font-bold">{value}</dd>
      {hint && <dd className="mt-0.5 text-[11px] leading-relaxed text-muted"><Prose text={hint} /></dd>}
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
