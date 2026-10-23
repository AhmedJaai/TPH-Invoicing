"use client";

import { createContext, useContext } from "react";
import type { ShellCounts } from "./nav";

/**
 * أعدادُ القشرة لما يُرسَم داخل الصفحة — ألسنةُ المساحة تقرأ منها كم بنداً في كلّ لسان.
 * الوعدُ نفسُه الذي يقرؤه الشريط (`AppShell`)، فلا استعلامَ ثانٍ ولا رقمان لشيءٍ واحد.
 */
const ShellCountsContext = createContext<Promise<ShellCounts> | null>(null);

export function ShellCountsProvider({ counts, children }: { counts: Promise<ShellCounts>; children: React.ReactNode }) {
  return <ShellCountsContext.Provider value={counts}>{children}</ShellCountsContext.Provider>;
}

export function useShellCounts(): Promise<ShellCounts> | null {
  return useContext(ShellCountsContext);
}
