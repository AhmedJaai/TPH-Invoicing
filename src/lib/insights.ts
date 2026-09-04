/**
 * مولّد التوصيات.
 *
 * يقرأ ما جمعه النظام ويخرج نصائح قابلة للتنفيذ، مرتّبة بأثرها المالي —
 * لا ملاحظات عامة. كل توصية تحمل رقماً وسبباً وخطوة تالية واضحة.
 *
 * دوال خالصة: تأخذ نتائج التحليل وتُرجع توصيات. لا شبكة ولا قاعدة بيانات.
 */
import type { ItemSummary, SameNameCandidate, SupplierAging, MonthlySpend } from "./analytics";

export type InsightSeverity = "critical" | "warning" | "opportunity" | "info";

/** صفٌّ من الدليل خلف التوصية — فاتورة أو صنف بعينه. */
export interface InsightEvidence {
  label: string;
  sub?: string;
  amountMinor?: number;
  note?: string;
}

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** الأثر المالي بالهللات — يُرتَّب عليه، صفر لما لا أثر مالي مباشر له */
  impactMinor: number;
  action: string;
  /**
   * ما بُنيت عليه التوصية، صفّاً صفّاً.
   *
   * التوصية بلا دليلها دعوى: «تسع فواتير لا تصلح للخصم» لا تُفيد ما لم
   * تقل أيّها. فتُعرض مطويّةً تحتها، تُفتح بضغطة.
   */
  evidence: InsightEvidence[];
  /** كم بقي خارج القائمة المعروضة */
  evidenceMore?: number;
}

/** فاتورة بعينها تُساق دليلاً. */
export interface InvoiceRef {
  invoiceId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: Date;
  amountMinor: number;
  note?: string;
}

const MAX_EVIDENCE = 12;

function fromInvoices(rows: readonly InvoiceRef[]): Pick<Insight, "evidence" | "evidenceMore"> {
  const sorted = [...rows].sort((a, b) => b.amountMinor - a.amountMinor);
  return {
    evidence: sorted.slice(0, MAX_EVIDENCE).map((r) => ({
      label: r.invoiceNumber,
      sub: `${r.supplierName} · ${r.invoiceDate.toISOString().slice(0, 10)}`,
      amountMinor: r.amountMinor,
      note: r.note,
    })),
    evidenceMore: Math.max(0, sorted.length - MAX_EVIDENCE),
  };
}

export const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: "حرج",
  warning: "تنبيه",
  opportunity: "فرصة",
  info: "معلومة",
};

const riyals = (minor: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Math.abs(minor) / 100);

export interface InsightInput {
  items: readonly ItemSummary[];
  sameNameCandidates: readonly SameNameCandidate[];
  aging: readonly SupplierAging[];
  monthlySpend: readonly MonthlySpend[];
  vatAtRiskMinor: number;
  vatAtRiskCount: number;
  notTaxValidCount: number;
  unpaidTotalMinor: number;
  unpaidCount: number;
  unpostedCount: number;
  fixedAssetCount: number;

  /* ── الأدلّة: الصفوف التي بُنيت عليها الأرقام أعلاه ── */
  vatAtRiskInvoices?: readonly InvoiceRef[];
  notTaxValidInvoices?: readonly InvoiceRef[];
  unpaidInvoices?: readonly InvoiceRef[];
  unpostedInvoices?: readonly InvoiceRef[];
  fixedAssetInvoices?: readonly InvoiceRef[];
  suppliersWithoutContract: readonly string[];
  /** مورّدون نشطون لم يصل كشفهم عن الشهر المنقضي */
  suppliersMissingStatement: readonly string[];
  duplicatePaymentCount: number;
  asOf: Date;
}

export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];

  /* ── ضريبة المدخلات المعرّضة ── */
  if (input.vatAtRiskMinor > 0) {
    out.push({
      id: "vat-at-risk",
      severity: "critical",
      title: `${riyals(input.vatAtRiskMinor)} ريال ضريبة مدخلات معرّضة للضياع`,
      detail: `${input.vatAtRiskCount} فاتورة لا تحمل الأركان الأربعة للفاتورة الضريبية، فلا يجوز خصم ضريبتها.`,
      impactMinor: input.vatAtRiskMinor,
      action: "اطلب من هؤلاء المورّدين فاتورة ضريبية كاملة تحمل رقمنا الضريبي، وبديلاً عن الفواتير المبسطة مستقبلاً.",
      ...fromInvoices(input.vatAtRiskInvoices ?? []),
    });
  }

  /* ── أصناف باسم واحد عند مورّدين ── */
  if (input.sameNameCandidates.length > 0) {
    const top = input.sameNameCandidates[0];
    out.push({
      id: "same-name",
      severity: "info",
      title: `${input.sameNameCandidates.length} اسم صنف يتكرّر عند أكثر من مورّد`,
      detail: `أكبرها فارقاً «${top.cheaper.displayName}»: ${riyals(top.cheaper.lastUnitPriceMinor)} عند ${top.cheaper.supplierName} مقابل ${riyals(top.dearer.lastUnitPriceMinor)} عند ${top.dearer.supplierName}. وتطابق الاسم لا يعني تطابق الصنف — «عنب» عند محمصة كيلو بنّ، وعند لافا زجاجة كمبوتشا.`,
      // لا يُدّعى توفير قبل أن يؤكّد الإنسان أنّهما صنف واحد
      impactMinor: 0,
      action: "راجع القائمة: إن كانا الصنف نفسه فعلاً فوحّد الشراء عند الأرخص أو تفاوض على مطابقة السعر.",
      evidence: input.sameNameCandidates.slice(0, MAX_EVIDENCE).map((c) => ({
        label: c.normalized,
        sub: `${c.cheaper.supplierName} «${c.cheaper.displayName}» مقابل ${c.dearer.supplierName} «${c.dearer.displayName}»`,
        amountMinor: c.dearer.lastUnitPriceMinor - c.cheaper.lastUnitPriceMinor,
        note: `فارق ${Math.round(c.gapRatio * 100)}٪`,
      })),
      evidenceMore: Math.max(0, input.sameNameCandidates.length - MAX_EVIDENCE),
    });
  }

  /* ── ارتفاعات الأسعار ── */
  const rises = input.items
    .filter((i) => i.priceChange?.direction === "up" && i.priceChange.deltaRatio >= 0.05)
    .map((i) => {
      const perYear = i.averageDaysBetweenOrders
        ? (i.totalQuantity / Math.max(1, i.orderCount)) * (365 / i.averageDaysBetweenOrders)
        : i.totalQuantity;
      return { item: i, annual: Math.round(i.priceChange!.deltaMinor * perYear) };
    })
    .sort((a, b) => b.annual - a.annual);

  const annualRise = rises.reduce((s, r) => s + r.annual, 0);
  if (rises.length > 0 && annualRise > 0) {
    const top = rises[0];
    out.push({
      id: "price-rises",
      severity: annualRise > 100_000 ? "critical" : "warning",
      title: `ارتفاع الأسعار يكلّفك ${riyals(annualRise)} ريال سنوياً`,
      detail: `${rises.length} صنفاً ارتفع سعره ٥٪ فأكثر. أكبرها «${top.item.displayName}» بنسبة ${Math.round(top.item.priceChange!.deltaRatio * 100)}٪ — أثره وحده ${riyals(top.annual)} ريال في السنة.`,
      impactMinor: annualRise,
      action: "فاوض على الأصناف الثلاثة الأعلى أثراً أوّلاً، واطلب عرض سعر من مورّد بديل لتفاوض بورقة في يدك.",
      evidence: rises.slice(0, MAX_EVIDENCE).map((x) => ({
        label: x.item.displayName,
        sub: `${x.item.supplierName} · ${riyals(x.item.priceChange!.previousMinor)} ← ${riyals(x.item.priceChange!.currentMinor)}`,
        amountMinor: x.annual,
        note: `+${Math.round(x.item.priceChange!.deltaRatio * 100)}٪ · أثر سنوي مقدَّر`,
      })),
      evidenceMore: Math.max(0, rises.length - MAX_EVIDENCE),
    });
  }

  /* ── ذمم متقادمة ── */
  const overdue = input.aging.filter((a) => a.oldestDays >= 60);
  const overdueTotal = overdue.reduce((s, a) => s + a.buckets.d60 + a.buckets.d90 + a.buckets.older, 0);
  if (overdueTotal > 0) {
    out.push({
      id: "aged-payables",
      severity: "warning",
      title: `${riyals(overdueTotal)} ريال مستحقّة منذ أكثر من ٦٠ يوماً`,
      detail: `${overdue.length} مورّداً لهم مستحقّات متقادمة. أقدمها عند ${overdue[0].supplierName} منذ ${overdue[0].oldestDays} يوماً.`,
      impactMinor: overdueTotal,
      action: "التأخّر الطويل يفسد شروط التوريد ويضعف تفاوضك. أدرجها في دفعة أوّل الشهر القادمة.",
      evidence: overdue.slice(0, MAX_EVIDENCE).map((a) => ({
        label: a.supplierName,
        sub: `أقدم دين منذ ${a.oldestDays} يوماً`,
        amountMinor: a.buckets.d60 + a.buckets.d90 + a.buckets.older,
      })),
      evidenceMore: Math.max(0, overdue.length - MAX_EVIDENCE),
    });
  }

  /* ── فواتير غير مسدَّدة ── */
  if (input.unpaidCount > 0) {
    out.push({
      id: "unpaid",
      severity: "info",
      title: `${input.unpaidCount} فاتورة غير مسدَّدة بقيمة ${riyals(input.unpaidTotalMinor)} ريال`,
      detail: "هذا هو رصيدك المستحق للمورّدين الآن.",
      impactMinor: 0,
      action: "راجعها قبل توليد دفعة أوّل الشهر.",
      ...fromInvoices(input.unpaidInvoices ?? []),
    });
  }

  /* ── فواتير غير صالحة ضريبياً ── */
  if (input.notTaxValidCount > 0 && input.vatAtRiskMinor === 0) {
    out.push({
      id: "not-tax-valid",
      severity: "warning",
      title: `${input.notTaxValidCount} فاتورة ليست ضريبية كاملة`,
      detail: "لا تحمل الأركان الأربعة، فلا تصلح لخصم المدخلات.",
      impactMinor: 0,
      action: "اطلب البديل قبل السداد — بعد السداد يصعب انتزاع الفاتورة الصحيحة.",
      ...fromInvoices(input.notTaxValidInvoices ?? []),
    });
  }

  /* ── مدفوعات مكرّرة ── */
  if (input.duplicatePaymentCount > 0) {
    out.push({
      id: "duplicate-payments",
      severity: "critical",
      title: `${input.duplicatePaymentCount} دفعة يُشتبه بتكرارها`,
      detail: "تحويلان لنفس الجهة بنفس المبلغ في نفس اليوم.",
      impactMinor: 0,
      action: "راجعها فوراً — استرداد المبلغ المكرّر يصعب كلّما تأخّر.",
      evidence: [],
    });
  }

  /* ── فواتير بلا قيد ── */
  if (input.unpostedCount > 0) {
    out.push({
      id: "unposted",
      severity: "warning",
      title: `${input.unpostedCount} فاتورة لم تُقيَّد بعد`,
      detail: "مؤرشفة في الدرايف لكنها لم تدخل النظام المحاسبي.",
      impactMinor: 0,
      action: "قيّدها قبل إقفال الشهر — الفاتورة غير المقيَّدة تختفي من التقارير.",
      ...fromInvoices(input.unpostedInvoices ?? []),
    });
  }

  /* ── أصول ثابتة ── */
  if (input.fixedAssetCount > 0) {
    out.push({
      id: "fixed-assets",
      severity: "warning",
      title: `${input.fixedAssetCount} فاتورة فوق حدّ الرسملة`,
      detail: "معدّات تتجاوز ٣٬٠٠٠ ريال — تُرسمل وتُهلك على عمرها الإنتاجي ولا تُصرف دفعة واحدة.",
      impactMinor: 0,
      action: "راجعها مع المحاسب قبل الإقفال — صرفها دفعة واحدة يشوّه ربح الشهر.",
      ...fromInvoices(input.fixedAssetInvoices ?? []),
    });
  }

  /* ── مورّدون بلا عقد ── */
  if (input.suppliersWithoutContract.length > 0) {
    out.push({
      id: "no-contract",
      severity: "warning",
      title: `${input.suppliersWithoutContract.length} مورّد لا يصدر فواتير وبلا عقد توريد`,
      detail: `${input.suppliersWithoutContract.join(" · ")} — بلا عقد لا خصم ضريبة ولا إثبات مصروف.`,
      impactMinor: 0,
      action: "وقّع عقد توريد مكتوباً مع كل منهم، أو استبدله بمورّد يصدر فواتير ضريبية.",
      evidence: input.suppliersWithoutContract.map((n) => ({ label: n })),
    });
  }

  /* ── كشوف لم تصل ── */
  if (input.suppliersMissingStatement.length > 0) {
    out.push({
      id: "missing-statements",
      severity: "warning",
      title: `${input.suppliersMissingStatement.length} مورّد لم يصل كشفه`,
      detail: `${input.suppliersMissingStatement.join(" · ")} — بلا كشف لا تعرف إن كانت هناك فاتورة لم تصلك.`,
      impactMinor: 0,
      action: "اطلب الكشف الشهري منهم — الكشف هو ما يكشف الفاتورة الضائعة.",
      evidence: input.suppliersMissingStatement.map((n) => ({ label: n })),
    });
  }

  /* ── اتجاه المصروف ── */
  if (input.monthlySpend.length >= 2) {
    const last = input.monthlySpend[input.monthlySpend.length - 1];
    const prev = input.monthlySpend[input.monthlySpend.length - 2];
    if (prev.totalMinor > 0) {
      const ratio = (last.totalMinor - prev.totalMinor) / prev.totalMinor;
      if (Math.abs(ratio) >= 0.15) {
        const up = ratio > 0;
        out.push({
          id: "spend-trend",
          severity: up ? "warning" : "info",
          title: `مشترياتك ${up ? "ارتفعت" : "انخفضت"} ${Math.abs(Math.round(ratio * 100))}٪ عن الشهر السابق`,
          detail: `${last.month}: ${riyals(last.totalMinor)} ريال مقابل ${riyals(prev.totalMinor)} في ${prev.month}.`,
          impactMinor: Math.abs(last.totalMinor - prev.totalMinor),
          action: up
            ? "افحص إن كان السبب ارتفاع أسعار أم زيادة كميّات — العلاج يختلف تماماً."
            : "تحقّق أنّ الانخفاض ليس فواتير لم تصل بعد.",
          evidence: input.monthlySpend.slice(-6).map((m) => ({
            label: m.month,
            sub: `${m.invoiceCount} فاتورة`,
            amountMinor: m.totalMinor,
          })),
        });
      }
    }
  }

  const RANK: Record<InsightSeverity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.impactMinor - a.impactMinor);
}
