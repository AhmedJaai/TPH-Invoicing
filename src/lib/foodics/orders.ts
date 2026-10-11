/**
 * طلبُ فودكس من الواجهة ← البيعةُ نفسُها التي يُخرجها ملفُّ الإكسل.
 *
 * **بابان إلى قيدٍ واحد**: الطلبُ الذي دخل من ملفٍّ ثمّ من الواجهة يجب أن يكون
 * «هو هو» — وإلّا حُسب مرّتين. فالمفاتيحُ هنا مفاتيحُ `foodics-excel.ts` حرفاً:
 *
 *   البيعة   `FDX:{مرجع الطلب}`
 *   المنتج   `{رمزه}#P#{ترتيبه}`
 *   الخيار   `{رمزه}#M:{رمز أصله}#{ترتيبه}`
 *
 * وبصمةُ المحتوى من الحقول نفسِها بالترتيب نفسِه، فما لم يتغيّر يُقرأ «مكرَّراً»
 * لا «مُراجَعاً». وقيس ذلك على أربعة أسابيع مستورَدةٍ من الإكسل قبل أن يُكتب شيء.
 *
 * ── وما تُصلحه الواجهةُ في الطريق ──
 *
 * ضريبةُ البيعة هنا **صافيةٌ وكاملة**: ضريبةُ ما بِيع بخياراته، ناقصاً ضريبةَ ما
 * رُدّ. والملفُّ كان يُسقِط ضريبةَ الخيار المدفوع ويجمع ضريبةَ المرتجَع موجبةً.
 */
import { contentFingerprint } from "@/lib/sales/foodics-excel";
import type { ParsedRow, ParsedSale, ParsedSaleLine, ParsedSalesFile } from "@/lib/sales/file-import";
import { microToMinor } from "@/lib/sales/values";
import { parseFoodicsMoment, quantityToMilli, riyalsToMicro, riyalsToMinor } from "./money";
import { ORDER_STATUS, PAYMENT_TYPE, PRODUCT_STATUS, type FoodicsOrder } from "./types";

export const FOODICS_API_ADAPTER = "FOODICS_API";
export const SHAPE_API_ORDERS = "FOODICS_API_ORDERS";

/** الطلباتُ التي انتهى أمرُها — والمعلَّقُ والجاري يأتيان حين يُغلَقان. */
const SETTLED_ORDER = new Set<number>([ORDER_STATUS.CLOSED, ORDER_STATUS.RETURNED, ORDER_STATUS.VOID]);

export function isSettledOrder(order: Pick<FoodicsOrder, "status">): boolean {
  return SETTLED_ORDER.has(order.status);
}

/**
 * طلبٌ على «House Account» وحده — **مشروبُ موظَّف، لا بيع** (أحمد، ١١ أكتوبر ٢٠٢٦).
 *
 * يُصنَع ويُستهلَك فيدخل الجرد، ولا يُقبَض عنه شيء: فلا إيرادَ له ولا ضريبة، وليس
 * ديناً على أحد. فبنودُه «مجّانيّة» (`isComplimentary`) ومجاميعُه المالية صفرٌ بدليل.
 * وطلبٌ دُفع بعضُه على الحساب وبعضُه بغيره يبقى بيعاً — لم يقع مثلُه في ٢٢ ألف طلب.
 */
export function isStaffOrder(order: Pick<FoodicsOrder, "payments">): boolean {
  const payments = order.payments ?? [];
  return payments.length > 0 && payments.every((p) => p.payment_method?.type === PAYMENT_TYPE.HOUSE_ACCOUNT);
}

/** حالُ البند بالكلمة التي يكتبها تصديرُ فودكس — وعليها بصمةُ المحتوى. */
export function productStatusLabel(status: number): string {
  switch (status) {
    case PRODUCT_STATUS.CLOSED: return "Done";
    case PRODUCT_STATUS.VOID: return "Void";
    case PRODUCT_STATUS.RETURNED: return "Returned";
    case PRODUCT_STATUS.MOVED: return "Moved";
    case PRODUCT_STATUS.DECLINED: return "Declined";
    case PRODUCT_STATUS.PENDING: return "Pending";
    case PRODUCT_STATUS.ACTIVE: return "Active";
    default: return `Status ${status}`;
  }
}

/** ما لم يُصنَع: الملغى، والمنقولُ إلى طلبٍ آخر (يُحسَب هناك)، والمرفوض. */
function isVoidStatus(status: number): boolean {
  return status === PRODUCT_STATUS.VOID || status === PRODUCT_STATUS.MOVED || status === PRODUCT_STATUS.DECLINED;
}

function slug(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 80);
}

export interface OrderProblem {
  reference: number;
  reason: string;
}

export interface ConvertedOrders {
  file: ParsedSalesFile;
  /** طلباتٌ لم تُحوَّل، بسببها — تُعرَض ولا تُبتلَع. */
  problems: OrderProblem[];
}

/**
 * يحوّل طلباتٍ منتهية إلى «ملفّ مبيعات» يكتبه مسارُ الاستيراد القائم.
 * وما لا يُقرأ مبلغُه يُردّ طلبُه بسببه — لا يُكتب بصفر.
 */
export function ordersToSalesFile(orders: readonly FoodicsOrder[]): ConvertedOrders {
  const sales: ParsedSale[] = [];
  const rows: ParsedRow[] = [];
  const problems: OrderProblem[] = [];
  let rowNumber = 0;

  for (const order of orders) {
    if (!isSettledOrder(order)) continue;
    if ((order.combos ?? []).length > 0) {
      problems.push({ reference: order.reference, reason: "طلبٌ فيه «كومبو» — صيغةٌ لم تُفحَص بعد، فلم يُقيَّد بالتخمين" });
      continue;
    }

    const staff = isStaffOrder(order);
    const saleExternalId = `FDX:${order.reference}`;
    const businessDate = order.business_date;
    const branchLabel = order.branch?.reference?.trim() || order.branch?.name?.trim() || null;
    const lines: ParsedSaleLine[] = [];
    const orderRows: ParsedRow[] = [];
    const occurrence = new Map<string, number>();
    let vatMicro = 0;
    let grossMinor = 0;
    let refundMinor = 0;
    let discountMinor = 0;
    let unreadable: string | null = null;

    const nextOf = (key: string) => {
      const n = (occurrence.get(key) ?? 0) + 1;
      occurrence.set(key, n);
      return n;
    };
    const taxOf = (taxes: readonly { pivot: { amount?: number | null } }[] | undefined) =>
      (taxes ?? []).reduce((s, t) => s + (riyalsToMicro(t.pivot.amount) ?? 0), 0);

    for (const p of order.products ?? []) {
      const name = (p.product?.name_localized?.trim() || p.product?.name?.trim()) ?? "";
      const sku = p.product?.sku?.trim() || (name ? `NAME:${slug(name)}` : "");
      const quantityMilli = quantityToMilli(p.quantity);
      const lineTotalMinor = riyalsToMinor(p.total_price);
      const unitPriceMinor = riyalsToMinor(p.unit_price);
      if (sku === "" || quantityMilli === null || lineTotalMinor === null || unitPriceMinor === null) {
        unreadable = `بندٌ لم يُقرأ (${name || "بلا اسم"}): رمزُه أو كمّيّتُه أو مبلغُه غائب`;
        break;
      }
      const isVoid = isVoidStatus(p.status);
      const isRefund = p.status === PRODUCT_STATUS.RETURNED;
      const sourceStatus = productStatusLabel(p.status);
      const lineDiscountMinor = riyalsToMinor(p.discount_amount) ?? 0;
      const listMinor = Math.round((Math.abs(unitPriceMinor) * Math.abs(quantityMilli)) / 1000);

      rowNumber++;
      const line: ParsedSaleLine = {
        externalId: `${sku}#P#${nextOf(`${sku}|P|`)}`,
        productExternalId: sku,
        name,
        category: p.product?.category?.name?.trim() || null,
        quantityMilli: Math.abs(quantityMilli),
        unitPriceMinor: Math.abs(unitPriceMinor),
        lineTotalMinor: Math.abs(lineTotalMinor),
        sourceStatus,
        isRefund,
        isVoid,
        isComplimentary: !isVoid && !isRefund && (staff || (listMinor > 0 && (lineTotalMinor === 0 || Math.abs(lineDiscountMinor) >= listMinor))),
        isModifier: false,
        parentExternalId: null,
        parentLineExternalId: null,
        modifiers: null,
        sourceUnitCostMinor: quantityMilli === 0 ? null : (() => {
          const cost = riyalsToMicro(p.total_cost);
          return cost === null ? null : microToMinor(Math.round((cost * 1000) / Math.abs(quantityMilli)));
        })(),
        contentHash: contentFingerprint([quantityMilli, sourceStatus, lineTotalMinor, businessDate, branchLabel ?? ""]),
        rowNumbers: [rowNumber],
      };
      lines.push(line);
      orderRows.push({
        rowNumber, status: "PARSED", reason: null, saleExternalId,
        raw: { order_reference: String(order.reference), sku, name, type: "Product", status: sourceStatus, quantity: String(p.quantity), total_price: String(p.total_price ?? "") },
      });

      if (!isVoid) {
        if (isRefund) refundMinor += Math.abs(lineTotalMinor);
        else grossMinor += Math.abs(lineTotalMinor);
        discountMinor += lineDiscountMinor;
      }
      let lineTaxMicro = taxOf(p.taxes);

      for (const o of p.options ?? []) {
        const optionName = o.modifier_option?.name?.trim() ?? "";
        const optionSku = o.modifier_option?.sku?.trim() || (optionName ? `NAME:${slug(optionName)}` : "");
        const optionTotalMinor = riyalsToMinor(o.total_price);
        const optionUnitMinor = riyalsToMinor(o.unit_price);
        if (optionSku === "" || optionTotalMinor === null || optionUnitMinor === null) {
          unreadable = `خيارٌ لم يُقرأ على «${name}»`;
          break;
        }
        rowNumber++;
        /* كمّيّةُ الخيار كمّيّةُ أصله — كما يكتبها التصدير، وعليها تُحسَب الوصفة */
        const optionLine: ParsedSaleLine = {
          externalId: `${optionSku}#M:${sku}#${nextOf(`${optionSku}|M|${sku}`)}`,
          productExternalId: optionSku,
          name: optionName,
          category: null,
          quantityMilli: Math.abs(quantityMilli),
          unitPriceMinor: Math.abs(optionUnitMinor),
          lineTotalMinor: Math.abs(optionTotalMinor),
          sourceStatus,
          isRefund,
          isVoid,
          isComplimentary: false,
          isModifier: true,
          parentExternalId: sku,
          parentLineExternalId: line.externalId,
          modifiers: null,
          sourceUnitCostMinor: null,
          contentHash: contentFingerprint([quantityMilli, sourceStatus, optionTotalMinor, businessDate, branchLabel ?? ""]),
          rowNumbers: [rowNumber],
        };
        lines.push(optionLine);
        line.modifiers = [...(line.modifiers ?? []), optionName];
        const optionExclusiveMicro = riyalsToMicro(o.tax_exclusive_total_price);
        const optionTotalMicro = riyalsToMicro(o.total_price);
        if (optionExclusiveMicro !== null && optionTotalMicro !== null) lineTaxMicro += optionTotalMicro - optionExclusiveMicro;
        orderRows.push({
          rowNumber, status: "PARSED", reason: null, saleExternalId,
          raw: { order_reference: String(order.reference), sku: optionSku, name: optionName, type: "Modifier Option", parent_item_sku: sku, status: sourceStatus, quantity: String(p.quantity), total_price: String(o.total_price ?? "") },
        });
      }
      if (unreadable) break;
      if (!isVoid) vatMicro += isRefund ? -lineTaxMicro : lineTaxMicro;
    }

    if (unreadable) {
      problems.push({ reference: order.reference, reason: unreadable });
      continue;
    }

    /* خصمُ الطلب كلِّه فوق خصم بنوده */
    discountMinor += riyalsToMinor(order.discount_amount) ?? 0;

    /* مشروبُ الموظَّف: كمّيّاتُه تبقى للجرد، ومالُه صفرٌ بدليل — لا إيرادَ ولا ضريبةَ ولا مردود */
    if (staff) {
      grossMinor = 0;
      refundMinor = 0;
      discountMinor = 0;
      vatMicro = 0;
    }

    sales.push({
      externalId: saleExternalId,
      orderStatus: order.status === ORDER_STATUS.RETURNED ? "Returned" : order.status === ORDER_STATUS.VOID ? "Void" : "Done",
      businessDate,
      soldAt: parseFoodicsMoment(order.closed_at) ?? parseFoodicsMoment(order.opened_at) ?? parseFoodicsMoment(order.created_at) ?? new Date(`${businessDate}T12:00:00Z`),
      branchLabel,
      grossMinor,
      discountMinor,
      refundMinor,
      vatMinor: microToMinor(vatMicro),
      netMinor: grossMinor,
      orderCount: 1,
      isVoid: lines.length > 0 && lines.every((l) => l.isVoid),
      lines,
    });
    rows.push(...orderRows);
  }

  const dates = sales.map((s) => s.businessDate).sort();
  return {
    file: {
      adapter: FOODICS_API_ADAPTER,
      shape: SHAPE_API_ORDERS,
      sales,
      rows,
      periodStart: dates[0] ?? null,
      periodEnd: dates[dates.length - 1] ?? null,
      warnings: [],
      recognisedColumns: [],
      unrecognisedColumns: [],
    },
    problems,
  };
}

/* ─────────────────────────── مرآةُ الطلب ودفعاته ─────────────────────────── */

export interface OrderMirror {
  id: string;
  reference: number;
  businessDate: string;
  status: number;
  type: number;
  source: number;
  totalMinor: number;
  discountMinor: number;
  /** ضريبةُ ما لم يُلغَ من بنوده وخياراتها كما حسبها فودكس — موجبةٌ حتى في طلب المرتجَع. */
  vatMinor: number;
  originalReference: number | null;
  openedAt: Date | null;
  closedAt: Date | null;
  sourceUpdatedAt: Date;
}

export interface PaymentMirror {
  id: string;
  orderId: string;
  methodType: number;
  methodName: string;
  amountMinor: number;
  tipsMinor: number;
  businessDate: string;
  addedAt: Date | null;
}

/** الطلبُ كما قاله فودكس — رأسُه ودفعاتُه، للمقارنة بالبنك والصندوق. `null` إن لم يُقرأ إجماليُّه. */
export function mirrorOrder(order: FoodicsOrder): { order: OrderMirror; payments: PaymentMirror[] } | null {
  const totalMinor = riyalsToMinor(order.total_price);
  const updated = parseFoodicsMoment(order.updated_at);
  if (totalMinor === null || updated === null) return null;
  let vatMicro = 0;
  for (const p of order.products ?? []) {
    if (isVoidStatus(p.status)) continue;
    for (const t of p.taxes ?? []) vatMicro += riyalsToMicro(t.pivot.amount) ?? 0;
    for (const o of p.options ?? []) {
      const exclusive = riyalsToMicro(o.tax_exclusive_total_price);
      const total = riyalsToMicro(o.total_price);
      if (exclusive !== null && total !== null) vatMicro += total - exclusive;
    }
  }
  const payments: PaymentMirror[] = [];
  for (const p of order.payments ?? []) {
    const amountMinor = riyalsToMinor(p.amount);
    if (amountMinor === null || !p.payment_method) return null;
    payments.push({
      id: p.id,
      orderId: order.id,
      methodType: p.payment_method.type,
      methodName: p.payment_method.name,
      amountMinor,
      tipsMinor: riyalsToMinor(p.tips) ?? 0,
      businessDate: p.business_date ?? order.business_date,
      addedAt: parseFoodicsMoment(p.added_at),
    });
  }
  return {
    order: {
      id: order.id,
      reference: order.reference,
      businessDate: order.business_date,
      status: order.status,
      type: order.type,
      source: order.source,
      totalMinor,
      discountMinor: riyalsToMinor(order.discount_amount) ?? 0,
      vatMinor: microToMinor(vatMicro),
      originalReference: order.original_order?.reference ?? null,
      openedAt: parseFoodicsMoment(order.opened_at),
      closedAt: parseFoodicsMoment(order.closed_at),
      sourceUpdatedAt: updated,
    },
    payments,
  };
}
