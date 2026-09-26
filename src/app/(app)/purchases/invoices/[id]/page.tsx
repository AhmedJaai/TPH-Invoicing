import { InvoiceView } from "./invoice-view";

export const dynamic = "force-dynamic";

/** ملفُّ الفاتورة صفحةً — حين يُحمَّل رابطُه مباشرة. ومن القوائم يُفتح لوحاً (`@drawer`). */
export default function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ act?: string }> }) {
  return <InvoiceView params={params} searchParams={searchParams} mode="page" />;
}
