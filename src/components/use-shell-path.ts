"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { isInspectorPath } from "@/lib/inspector";

/**
 * مسارُ الصفحة التي تحت لوح الفحص — للقشرة وحدها.
 *
 * اللوحُ يغيّر العنوانَ إلى ملفّ السجلّ (`/suppliers/x`) والقائمةُ تحته كما
 * هي. فالشريطُ الجانبيّ والألسنةُ والفتاتُ تقرأ مسارَ القائمة لا الملفّ —
 * وإلّا فُتح مورّدٌ من «يحتاج قرارك» فقفز الشريطُ إلى «المورّدون» وألسنتُه
 * فوق طابورٍ لم يتغيّر.
 *
 * ومن حمّل الملفَّ مباشرةً (صفحةً كاملة) فمسارُه هو الملفّ نفسه: الحالُ
 * الأولى تُؤخذ من العنوان كما هو.
 */
export function useShellPath(): string {
  const pathname = usePathname() ?? "/";
  const [base, setBase] = useState(pathname);
  if (!isInspectorPath(pathname) && pathname !== base) setBase(pathname);
  return isInspectorPath(pathname) ? base : pathname;
}
