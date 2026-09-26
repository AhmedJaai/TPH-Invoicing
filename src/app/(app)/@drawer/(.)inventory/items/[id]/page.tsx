import { ItemView } from "@/app/(app)/inventory/items/[id]/item-view";

export const dynamic = "force-dynamic";

/** ملفُّ الصنف لوحاً فوق القائمة — الملفُّ نفسُه في `item-view.tsx`. */
export default function ItemDrawer({ params }: { params: Promise<{ id: string }> }) {
  return <ItemView params={params} mode="drawer" />;
}
