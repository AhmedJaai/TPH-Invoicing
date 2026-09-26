import { AppShell } from "@/components/page-shell";
import { currentUser } from "@/lib/session";

/**
 * تخطيطُ التطبيق: القشرةُ هنا مرّةً، والصفحاتُ داخلها.
 *
 * ومن لا جلسةَ له تُرسَم الصفحةُ وحدها — وهي تحوّله إلى الدخول. ولا
 * يُرسَم شريطُ تنقّلٍ لزائرٍ لا دورَ له.
 */
export default async function AppLayout({
  children,
  drawer,
}: {
  children: React.ReactNode;
  /** لوحُ الفحص — `@drawer`: ملفُّ مورّدٍ أو فاتورةٍ أو صنفٍ أو حركةٍ فوق القائمة. */
  drawer: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) return <>{children}</>;
  return <AppShell user={user} drawer={drawer}>{children}</AppShell>;
}
