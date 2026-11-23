"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/http-client";
import { formatRiyals } from "@/lib/money";
import { buttonClass, fieldClass } from "./ui-tokens";
import { toast } from "./ui-client";
import { T } from "@/components/i18n/t";

/**
 * كتابةُ ميزانية الشهر لكلّ باب — المبلغُ نصٌّ بالريال يحوّله الخادم، ويسري من الشهر المختار.
 * والحفظُ صفٌّ جديد في السجلّ: ما كان قبله يبقى بتاريخه.
 */
export function BudgetEditor({ lines, fromMonth, fromLabel }: { lines: { line: string; label: string; currentMinor: number | null }[]; fromMonth: string; fromLabel: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.line, l.currentMinor === null ? "" : formatRiyals(l.currentMinor)])),
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function save(line: string, label: string) {
    if (busy) return;
    setBusy(line);
    const raw = values[line]?.trim() ?? "";
    const r = await postJson<{ message?: string }>("/api/budget", { line, amount: raw === "" ? null : raw, fromMonth });
    setBusy(null);
    if (!r.ok) {
      toast({ tone: "danger", title: `تعذّر حفظ ميزانية «${label}»`, body: r.error });
      return;
    }
    toast({ tone: "ok", title: r.data.message ?? "حُفظت" });
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        <T s="يسري ما تكتبه من {0}، وما كان قبله يبقى في السجل. اترك الحقل فارغاً واحفظ لإلغاء ميزانية الباب." a={[<bdi key="0" className="font-bold text-ink">{fromLabel}</bdi>]} />
      </p>
      <ul className="divide-y divide-line-soft rounded-xl border border-line">
        {lines.map((l) => {
          const changed = (values[l.line] ?? "") !== (l.currentMinor === null ? "" : formatRiyals(l.currentMinor));
          return (
            <li key={l.line} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <label htmlFor={`budget-${l.line}`} className="min-w-28 flex-1 text-xs font-bold">{l.label}</label>
              <input
                id={`budget-${l.line}`}
                inputMode="decimal"
                dir="ltr"
                placeholder="بلا ميزانية"
                value={values[l.line] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [l.line]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void save(l.line, l.label); }}
                className={`${fieldClass("sm")} w-36 text-end`}
              />
              <span className="text-[11px] text-muted">ريال شهرياً</span>
              <button type="button" disabled={!changed || busy !== null} aria-busy={busy === l.line} onClick={() => void save(l.line, l.label)} className={buttonClass(changed ? "primary" : "secondary", "sm")}>
                احفظ
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
