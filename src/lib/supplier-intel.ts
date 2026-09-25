/**
 * ذكاءُ المورّد — ما يُشتقّ لملفّه من بياناتٍ مقيَّدة، دوالَّ خالصة.
 *
 * لا يحسب هذا الملفّ «عليك» ولا «لك»: ذلك في `supplier-balances.ts`
 * وحده، ويُمرَّر إلى هنا رقماً. وما يفعله هنا أن **يوزّع** ذلك الرقم
 * على أعمار الفواتير، ويقرأ من التخصيصات كيف تسدّد، ومن البنود كيف
 * تحرّك السعر، ومن القيود كشفَ حسابٍ يُطبَع. وما لا تكفي بياناتُه
 * يبقى `null` — «غير معروف» — ولا يصير صفراً.
 */

/* ───────────────────────── أعمار الدَّين ───────────────────────── */

/**
 * شرائحُ العمر بالأيّام منذ تاريخ الفاتورة. والحدودُ تُحسَب في القاعدة
 * بـ`invoice_date < now() - N days` — بالمعنى نفسه الذي يحسب به
 * `loadOverdueBalances` «المتأخّر»، فلا يقول الملفّ «أكثر من ٦٠» رقماً
 * ويقول الطابور غيره.
 */
export const AGE_BUCKETS = [
  { id: "0-30", label: "حتى 30 يوماً" },
  { id: "31-60", label: "31–60 يوماً" },
  { id: "61-90", label: "61–90 يوماً" },
  { id: "90+", label: "أكثر من 90 يوماً" },
] as const;

export type AgeBucketIndex = 0 | 1 | 2 | 3;

/** العتبةُ التي يُعدّ بعدها الدَّين متأخّراً — هي نفسُها في «يحتاج قرارك». */
export const OVERDUE_BUCKET: AgeBucketIndex = 2;

export interface OpenInvoiceAge {
  id: string;
  number: string;
  /** YYYY-MM-DD */
  date: string;
  /** ما بقي عليها فوق هللة التقريب — كما يحسبه مصدرُ الأرصدة. */
  openMinor: number;
  ageDays: number;
  bucket: AgeBucketIndex;
}

export interface OwedAgeing {
  /** ما عليك موزَّعاً على الشرائح الأربع — مجموعُها `owedMinor` بالهللة. */
  buckets: [number, number, number, number];
  /** عمرُ أقدم فاتورةٍ ما زال عليها شيءٌ بعد خصم رصيدك — `null` إن لم يبقَ شيء. */
  oldestOwedDays: number | null;
  /** ما عليك في الشريحتين المتأخّرتين (أكثر من ٦٠ يوماً). */
  overdueMinor: number;
  /** الفواتيرُ التي يقع عليها الدَّين فعلاً، الأقدمُ أوّلاً، وما بقي على كلٍّ منها. */
  carrying: { id: string; number: string; date: string; ageDays: number; owedMinor: number; bucket: AgeBucketIndex }[];
  /**
   * ما لا يُعرف عمرُه: دَينٌ أكبر من مجموع الفواتير المفتوحة. لا يقع
   * إلّا إن تغيّرت القاعدة بين قراءتين؛ ويُعرَض ولا يُطوى في شريحة.
   */
  unagedMinor: number;
}

/**
 * يوزّع «عليك له» على أعمار الفواتير.
 *
 * الرقمُ من المصدر الواحد (`supplierBalance().owedMinor`) = المفتوح −
 * رصيدُك عنده. وسياسةُ التخصيص معلَنة: الأقدمُ أوّلاً — فرصيدُك يأكل
 * أقدمَ الفواتير، وما بقي عليك يقع على **أحدثها**. فيُوزَّع الرقم من
 * الأحدث إلى الأقدم، ويكون جزؤه المتأخّر هو `overdueOwedMinor` بعينه.
 */
export function ageOwed(open: readonly OpenInvoiceAge[], owedMinor: number): OwedAgeing {
  const buckets: [number, number, number, number] = [0, 0, 0, 0];
  const carrying: OwedAgeing["carrying"] = [];
  let left = Math.max(0, owedMinor);

  const newestFirst = [...open]
    .filter((i) => i.openMinor > 0)
    .sort((a, b) => (a.date === b.date ? a.ageDays - b.ageDays : a.date < b.date ? 1 : -1));

  for (const inv of newestFirst) {
    if (left <= 0) break;
    const take = Math.min(left, inv.openMinor);
    buckets[inv.bucket] += take;
    carrying.push({ id: inv.id, number: inv.number, date: inv.date, ageDays: inv.ageDays, owedMinor: take, bucket: inv.bucket });
    left -= take;
  }

  carrying.reverse();
  return {
    buckets,
    oldestOwedDays: carrying.length > 0 ? carrying[0].ageDays : null,
    overdueMinor: buckets[2] + buckets[3],
    carrying,
    unagedMinor: left,
  };
}

/** نبرةُ العمر: ما جاوز ٩٠ خطر، وما جاوز ٦٠ تنبيه، وما دونها عاديّ. */
export function ageTone(days: number | null): "danger" | "warn" | "muted" {
  if (days === null) return "muted";
  if (days > 90) return "danger";
  if (days > 60) return "warn";
  return "muted";
}

/* ───────────────────────── انتظامُ السداد ───────────────────────── */

/** دون هذا من الفواتير المسدَّدة لا يُقال «متوسّط» — عيّنةٌ لا تكفي. */
export const MIN_SETTLED_SAMPLE = 3;

export interface Settlement {
  /** YYYY-MM-DD — تاريخ الفاتورة */
  invoiceDate: string;
  /** YYYY-MM-DD — تاريخُ آخر دفعةٍ خُصّصت عليها (يومُ اكتمال سدادها) */
  settledOn: string;
}

export interface PaymentReliability {
  invoiceCount: number;
  settledCount: number;
  /** مسدَّدةٌ بتخصيصٍ من دفعةٍ معروفةِ التاريخ — عليها وحدها يُحسب المتوسّط. */
  sampleCount: number;
  /** متوسّطُ الأيّام من الفاتورة إلى اكتمال سدادها — `null` إن قلّت العيّنة. */
  averageDays: number | null;
  /** الوسيط — أصدقُ من المتوسّط حين تشذّ فاتورةٌ واحدة. */
  medianDays: number | null;
  /** سُدّدت قبل تاريخها أو في يومه: رصيدٌ سبقها. */
  prepaidCount: number;
}

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function paymentReliability(
  settlements: readonly Settlement[],
  counts: { invoiceCount: number; settledCount: number },
): PaymentReliability {
  const days = settlements
    .map((s) => Math.round((dayMs(s.settledOn) - dayMs(s.invoiceDate)) / 86_400_000))
    .filter((d) => Number.isFinite(d));
  const clamped = days.map((d) => Math.max(0, d)).sort((a, b) => a - b);
  const enough = clamped.length >= MIN_SETTLED_SAMPLE;
  const mid = Math.floor(clamped.length / 2);
  return {
    invoiceCount: counts.invoiceCount,
    settledCount: counts.settledCount,
    sampleCount: clamped.length,
    averageDays: enough ? Math.round(clamped.reduce((s, d) => s + d, 0) / clamped.length) : null,
    medianDays: enough
      ? clamped.length % 2 === 1 ? clamped[mid] : Math.round((clamped[mid - 1] + clamped[mid]) / 2)
      : null,
    prepaidCount: days.filter((d) => d <= 0).length,
  };
}

/* ───────────────────────── تاريخُ الأسعار ───────────────────────── */

export interface PriceLine {
  /** الوصفُ بعد التطبيع — والمورّدُ واحدٌ هنا، فالمفتاحُ `${supplierId}::${normalized}` ضمناً. */
  normalized: string;
  description: string;
  /** YYYY-MM-DD */
  date: string;
  unitPriceMinor: number;
  invoiceId: string;
  invoiceNumber: string;
}

export interface ProductPriceHistory {
  normalized: string;
  displayName: string;
  purchases: number;
  firstMinor: number;
  firstDate: string;
  lastMinor: number;
  lastDate: string;
  lastInvoiceId: string;
  /** النسبةُ من أوّل سعرٍ إلى آخره، بعددٍ صحيح من الهللات — `null` لشراءٍ واحد أو أوّلٍ صفر. */
  changePct: number | null;
  /** آخرُ تغيّر: السعر الحاليّ مقابل آخر سعرٍ **خالفه** — `null` إن لم يتغيّر قطّ. */
  lastMove: { previousMinor: number; previousDate: string; pct: number | null } | null;
  /** سعرُ كلّ شراءٍ بترتيبه — للمنحنى، من قيمٍ حقيقيّة وحدها. */
  points: number[];
}

function pct(from: number, to: number): number | null {
  return from === 0 ? null : Math.round(((to - from) * 100) / from);
}

/**
 * سعرُ كلّ صنفٍ عند المورّد نفسه عبر الزمن.
 *
 * المقارنةُ داخل المورّد لا عبره (درسُ «العنب»)، ومن سعر الوحدة الفعليّ
 * (`line-pricing.ts`) لا سعر القائمة. والصنفُ الذي اشتُري مرّةً لا
 * «تغيّر» له — يُعرض سعرُه ولا تُخترع له نسبة.
 */
export function priceHistory(lines: readonly PriceLine[]): ProductPriceHistory[] {
  const groups = new Map<string, PriceLine[]>();
  for (const l of lines) {
    if (!l.normalized || l.unitPriceMinor <= 0) continue;
    const g = groups.get(l.normalized) ?? [];
    g.push(l);
    groups.set(l.normalized, g);
  }

  const out: ProductPriceHistory[] = [];
  for (const [normalized, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const previous = [...sorted].reverse().find((p) => p.unitPriceMinor !== last.unitPriceMinor);
    out.push({
      normalized,
      displayName: list.reduce((best, r) => (r.description.length > best.length ? r.description : best), list[0].description),
      purchases: sorted.length,
      firstMinor: first.unitPriceMinor,
      firstDate: first.date,
      lastMinor: last.unitPriceMinor,
      lastDate: last.date,
      lastInvoiceId: last.invoiceId,
      changePct: sorted.length >= 2 ? pct(first.unitPriceMinor, last.unitPriceMinor) : null,
      lastMove: previous
        ? { previousMinor: previous.unitPriceMinor, previousDate: previous.date, pct: pct(previous.unitPriceMinor, last.unitPriceMinor) }
        : null,
      points: sorted.map((p) => p.unitPriceMinor),
    });
  }

  /* ما تحرّك أوّلاً وبالأكبر، ثمّ الأكثر شراءً */
  return out.sort(
    (a, b) =>
      Math.abs(b.lastMove?.pct ?? 0) - Math.abs(a.lastMove?.pct ?? 0) ||
      b.purchases - a.purchases ||
      a.displayName.localeCompare(b.displayName, "ar"),
  );
}

/* ───────────────────────── كشفُ الحساب ───────────────────────── */

export interface LedgerEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  kind: "INVOICE" | "PAYMENT";
  reference: string;
  /** للفاتورة: إجماليُّها. للدفعة: ما وصل المورّد (المبلغ ناقص رسم التحويل). */
  amountMinor: number;
  href?: string;
}

export interface LedgerRow extends LedgerEntry {
  /** الرصيد بعد القيد: موجبٌ عليك، وسالبٌ لك عنده. */
  balanceMinor: number;
}

export interface Ledger {
  openingMinor: number;
  rows: LedgerRow[];
  invoicedMinor: number;
  paidMinor: number;
  closingMinor: number;
}

/**
 * كشفُ حسابٍ من قيودنا: رصيدٌ افتتاحيّ، ثمّ الفواتير والمدفوعات
 * بترتيبها، ورصيدٌ جارٍ بعد كلّ قيد. والفاتورة قبل الدفعة في اليوم
 * الواحد — كما تقع: البضاعة ثمّ ثمنها.
 */
export function buildLedger(openingMinor: number, entries: readonly LedgerEntry[]): Ledger {
  const sorted = [...entries].sort((a, b) =>
    a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.kind === b.kind ? 0 : a.kind === "INVOICE" ? -1 : 1,
  );
  let running = openingMinor;
  let invoiced = 0;
  let paid = 0;
  const rows = sorted.map((e) => {
    if (e.kind === "INVOICE") {
      running += e.amountMinor;
      invoiced += e.amountMinor;
    } else {
      running -= e.amountMinor;
      paid += e.amountMinor;
    }
    return { ...e, balanceMinor: running };
  });
  return { openingMinor, rows, invoicedMinor: invoiced, paidMinor: paid, closingMinor: running };
}
