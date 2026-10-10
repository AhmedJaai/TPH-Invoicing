"use client";

import { createContext, useContext } from "react";
import type { Role } from "@/lib/permissions";
import { openCommandPalette } from "@/lib/ui-events";
import { AreaTabs } from "./nav";
import { buttonClass } from "./ui-tokens";
import { Search } from "lucide-react";

/**
 * مَن يستعمل القشرة — دورُه واسمُه الأوّل، لما يُرسَم **قبل** أن تُبنى الصفحة.
 *
 * هيكلُ التحميل (`loading.tsx`) لا ينتظر الجلسة، فكان بلا ألسنةِ المساحة وبلا
 * التحيّة: يصل المحتوى فيقفز ستّين بكسلاً ويتبدّل العنوان. والقشرةُ تعرف
 * المستخدمَ أصلاً، فتُمرّره هنا مرّةً ويقرؤه الهيكل.
 *
 * عرضٌ لا حراسة: الصفحةُ والخادمُ يحرسان بالجلسة نفسها في كلّ حال.
 */
export interface ShellUser {
  role: Role;
  /** الاسمُ الأوّل — `null` في وضع التجربة أو حين لا اسم. */
  firstName: string | null;
}

const ShellUserContext = createContext<ShellUser | null>(null);

export function ShellUserProvider({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return <ShellUserContext.Provider value={user}>{children}</ShellUserContext.Provider>;
}

export function useShellUser(): ShellUser | null {
  return useContext(ShellUserContext);
}

/** ألسنةُ المساحة في هيكل التحميل — هي نفسُها التي سترسمها الصفحة، فلا يقفز ما تحتها. */
export function SkeletonAreaTabs() {
  const user = useShellUser();
  if (!user) return null;
  return <AreaTabs role={user.role} />;
}

/** «صباح الخير، أحمد» في هيكل «اليوم» — العنوانُ الذي سيصل، لا «اليوم» ثمّ يتبدّل. */
export function SkeletonGreeting({ greeting }: { greeting: string }) {
  const user = useShellUser();
  return <>{user?.firstName ? `${greeting}، ${user.firstName}` : greeting}</>;
}

/** زرٌّ يفتح البحث — لصفحة «لم نجد» داخل القشرة. */
export function OpenSearchButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" onClick={openCommandPalette} className={buttonClass("primary")}>
      <Search className="h-4 w-4" strokeWidth={2} aria-hidden />
      {children}
    </button>
  );
}
