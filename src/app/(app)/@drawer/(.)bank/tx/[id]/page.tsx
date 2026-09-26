import { TxView } from "@/app/(app)/bank/tx/[id]/tx-view";

export const dynamic = "force-dynamic";

/** ملفُّ الحركة لوحاً فوق السجلّ — الملفُّ نفسُه في `tx-view.tsx`. */
export default function TxDrawer({ params }: { params: Promise<{ id: string }> }) {
  return <TxView params={params} mode="drawer" />;
}
