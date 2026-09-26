import { SupplierView } from "@/app/(app)/suppliers/[slug]/supplier-view";

export const dynamic = "force-dynamic";

/** ملفُّ المورّد لوحاً فوق القائمة — الملفُّ نفسُه في `supplier-view.tsx`. */
export default function SupplierDrawer(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  return <SupplierView {...props} mode="drawer" />;
}
