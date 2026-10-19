"use client";

import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { currentTranslator, loadTranslator, subscribeTranslator } from "@/lib/i18n/dictionary-store";

const SLOT = /\{(\d+)\}/g;
const noServerTranslator = () => null;

/**
 * جملةٌ واحدة نصُّها وقيمُها معاً: `s` هي الجملة العربيّة و`{n}` مكانُ القيمة `a[n]`.
 * بالعربيّة تُرسم كما هي؛ وبالإنجليزيّة تُترجَم الجملةُ كاملةً وتُرتَّب قيمُها
 * بحسب ترجمتها — لا قطعةً قطعة، فتسلم الجملة ولا يتخلّلها عربيّ.
 */
export function T({ s, a = [] }: { s: string; a?: ReactNode[] }) {
  const tr = useSyncExternalStore(subscribeTranslator, currentTranslator, noServerTranslator);
  useEffect(() => {
    if (document.documentElement.lang === "en") loadTranslator().catch(() => {});
  }, []);
  const tpl = tr && typeof document !== "undefined" && document.documentElement.lang === "en" ? tr.template(s) : s;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of tpl.matchAll(SLOT)) {
    if (m.index > last) out.push(tpl.slice(last, m.index));
    out.push(<Fragment key={m.index}>{a[Number(m[1])]}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < tpl.length) out.push(tpl.slice(last));
  return <>{out}</>;
}
