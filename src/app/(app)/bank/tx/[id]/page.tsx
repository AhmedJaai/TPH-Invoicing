import { TxView } from "./tx-view";

export const dynamic = "force-dynamic";

/** ملفُّ حركة البنك صفحةً — حين يُحمَّل رابطُه مباشرة. ومن السجلّ يُفتح لوحاً (`@drawer`). */
export default function TxPage({ params }: { params: Promise<{ id: string }> }) {
  return <TxView params={params} mode="page" />;
}
