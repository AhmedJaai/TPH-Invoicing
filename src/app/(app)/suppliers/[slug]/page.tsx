import { SupplierView } from "./supplier-view";

export const dynamic = "force-dynamic";

/** ملفُّ المورّد صفحةً — حين يُحمَّل رابطُه مباشرة. ومن القوائم يُفتح لوحاً (`@drawer`). */
export default function SupplierPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  return <SupplierView {...props} mode="page" />;
}
