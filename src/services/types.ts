/**
 * أنواع مشتركة بين الخدمات.
 *
 * الخدمات طبقة داخلية في التطبيق نفسه، لا خدمات مصغّرة. الغرض منها أن
 * تتحمّل الواجهة البرمجية مسؤوليةً واحدة — استقبال الطلب والردّ — وأن
 * ينتقل المنطق إلى وحدات تُقرأ وتُختبر على حدة.
 */
import type { db } from "@/db";

/** معاملة قاعدة بيانات كما تمرّرها drizzle إلى الدالة الداخلية. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** سطر فاتورة كما يصل من الاستخراج، بنصوصه لا بأرقامه. */
export interface RawLine {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}
