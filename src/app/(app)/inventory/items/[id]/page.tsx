import { ItemView } from "./item-view";

export const dynamic = "force-dynamic";

/** ملفُّ الصنف صفحةً — حين يُحمَّل رابطُه مباشرة. ومن القوائم يُفتح لوحاً (`@drawer`). */
export default function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  return <ItemView params={params} mode="page" />;
}
