/**
 * موصل المبيعات — الواجهة وحدها.
 *
 * لا واجهة برمجية لأي مزوّد في هذا المستودع، ولا مفاتيح، ولا تفويض.
 * الغرض من هذا الملف أن يُكتب الموصل لاحقاً **بلا تغيير في أي شيء بعده**:
 * التقارير والجداول والحسابات كلّها تتعامل مع هذه الأنواع لا مع مزوّد.
 *
 * والدرس الذي يبرّر بناءه الآن: مزوّد الاستخراج بُني خلف واجهة منذ اليوم
 * الأوّل، فصار تبديله سطراً واحداً. ومجال المبيعات لو بُني على مزوّد بعينه
 * لأُعيدت كتابته كلّه عند أوّل تغيير.
 */

/** يوم عمل واحد كما يراه مصدر المبيعات. */
export interface SalesDay {
  /** YYYY-MM-DD */
  businessDate: string;
  grossMinor: number;
  discountMinor: number;
  refundMinor: number;
  vatMinor: number;
  netMinor: number;
  orderCount: number;
}

export interface SalesLineItem {
  externalProductId: string;
  name: string;
  category?: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface SalesTransaction {
  /** معرّف العملية عند المزوّد — عليه تقوم مناعة الاستيراد من التكرار */
  externalId: string;
  soldAt: Date;
  businessDate: string;
  grossMinor: number;
  discountMinor: number;
  refundMinor: number;
  vatMinor: number;
  netMinor: number;
  lines: SalesLineItem[];
}

export interface SalesProduct {
  externalId: string;
  name: string;
  category?: string;
  priceMinor?: number;
}

export type ConnectorStatus =
  | { connected: false; reason: string }
  | { connected: true; lastSyncAt: Date | null };

/**
 * ما يجب أن يوفّره أي مصدر مبيعات.
 * كل عملية تحمل `externalId` لأنّ المزامنة يجب أن تكون منيعة من التكرار —
 * الدرس نفسه الذي كلّفنا كشف بنك مستورداً ثلاث مرّات.
 */
export interface SalesConnector {
  /** اسم يُعرض للمستخدم */
  readonly name: string;
  status(): Promise<ConnectorStatus>;
  /** ملخّص يومي — أرخص من العمليات، ويكفي للوحة */
  fetchDays(from: string, to: string): Promise<SalesDay[]>;
  /** العمليات ببنودها — تلزم لتكلفة المبيعات لاحقاً */
  fetchTransactions(from: string, to: string): Promise<SalesTransaction[]>;
  fetchProducts(): Promise<SalesProduct[]>;
}

/**
 * الحال الافتراضي: لا مصدر.
 *
 * يرمي عند الطلب بدل أن يُرجع أصفاراً — الصفر يوحي بأنّ المقهى لم يبع
 * شيئاً، والرمي يجعل المستدعي يعلن «غير موصول» ولا يبني عليه رقماً.
 */
export class NotConnectedError extends Error {
  constructor(name = "مصدر المبيعات") {
    super(`${name} غير موصول. لا تُعرض أرقام مبيعات قبل وصله.`);
    this.name = "NotConnectedError";
  }
}

export const notConnected: SalesConnector = {
  name: "غير موصول",
  async status() {
    return { connected: false, reason: "لم يُوصَل مصدر مبيعات بعد" };
  },
  async fetchDays() {
    throw new NotConnectedError();
  },
  async fetchTransactions() {
    throw new NotConnectedError();
  },
  async fetchProducts() {
    throw new NotConnectedError();
  },
};

/**
 * الموصل الفعّال.
 *
 * يقرأ من متغيّر بيئة كما يفعل مزوّد الاستخراج. ولا يوجد اليوم إلا
 * «غير موصول» — وإضافة موصل لاحقاً تُسجَّل هنا ولا تمسّ شيئاً آخر.
 */
const CONNECTORS: Record<string, SalesConnector> = {
  none: notConnected,
};

export function activeSalesConnector(): SalesConnector {
  const key = (process.env.SALES_CONNECTOR ?? "none").toLowerCase();
  return CONNECTORS[key] ?? notConnected;
}

export async function salesAvailable(): Promise<boolean> {
  return (await activeSalesConnector().status()).connected;
}
