import { DocumentView } from "@/app/(app)/documents/file/[id]/document-view";

export const dynamic = "force-dynamic";

/** ملفُّ المستند لوحاً فوق القائمة — الملفُّ نفسُه في `document-view.tsx`. */
export default function DocumentDrawer({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentView params={params} mode="drawer" />;
}
