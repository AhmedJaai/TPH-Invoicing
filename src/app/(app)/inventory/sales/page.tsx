import { redirect } from "next/navigation";

/** المبيعاتُ انتقلت إلى «المالية» — جوابٌ واحد لسؤال «ماذا أبيع؟» (`/finance/sales`). */
export default function OldSalesPage() {
  redirect("/finance/sales");
}
