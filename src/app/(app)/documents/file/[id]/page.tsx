import { DocumentView } from "./document-view";

export const dynamic = "force-dynamic";

/** ملفُّ المستند صفحةً — حين يُحمَّل رابطُه مباشرة. ومن القوائم يُفتح لوحاً (`@drawer`). */
export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentView params={params} mode="page" />;
}
