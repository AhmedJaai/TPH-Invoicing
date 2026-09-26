import { InvoiceView } from "@/app/(app)/purchases/invoices/[id]/invoice-view";

export const dynamic = "force-dynamic";

/** ملفُّ الفاتورة لوحاً فوق القائمة — الملفُّ نفسُه في `invoice-view.tsx`. */
export default function InvoiceDrawer({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ act?: string }> }) {
  return <InvoiceView params={params} searchParams={searchParams} mode="drawer" />;
}
