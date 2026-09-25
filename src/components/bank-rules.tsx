"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { normalizeArabic, normalizeDigits } from "@/lib/search";
import { buttonClass } from "./ui-tokens";
import { toast } from "./ui-client";

export interface BankRuleRow {
  id: string;
  pattern: string;
  categoryLabel: string;
  supplier: string | null;
  note: string | null;
}

/** كم قاعدةً تُعرض قبل «اعرض الكلّ» — القائمةُ تطول مع كلّ كشف. */
const FIRST = 8;

const fold = (s: string) => normalizeArabic(normalizeDigits(s.toLowerCase()));

/**
 * قواعد التصنيف كما حُفظت — تُبحَث، وتُحذف بخطوتين.
 *
 * كانت أربعين صفّاً متتابعة بخطٍّ ثابت العرض يمطّ الحروفَ العربيّة. صارت
 * قائمةً قصيرة يُبحث فيها بالنصّ أو الباب أو المورّد، والباقي خلف «اعرض الكلّ».
 */
export function BankRules({ rows, canEdit }: { rows: BankRuleRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);

  const matched = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (words.length === 0) return rows;
    return rows.filter((r) => {
      const text = fold(`${r.pattern} ${r.categoryLabel} ${r.supplier ?? ""} ${r.note ?? ""}`);
      return words.every((w) => text.includes(w));
    });
  }, [q, rows]);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs leading-relaxed text-muted">
        لا قواعد بعد — تُنشأ من «صنّفها» عند استيراد كشف البنك، ثمّ تُطبَّق على كلّ كشفٍ بعده.
      </p>
    );
  }

  const shown = all || q ? matched : matched.slice(0, FIRST);

  async function remove(r: BankRuleRow) {
    setBusy(true);
    const res = await postJson<{ message?: string }>("/api/bank-rule", { action: "delete", id: r.id });
    setBusy(false);
    setAsking(null);
    if (res.ok) {
      toast({ tone: "ok", title: "حُذفت القاعدة", body: "الحركاتُ المصنَّفة بها قبلُ تبقى على تصنيفها." });
      router.refresh();
    } else {
      toast({ tone: "danger", title: "لم تُحذف القاعدة", body: res.error });
    }
  }

  return (
    <div className="space-y-3">
      <label className="relative flex items-center sm:max-w-sm">
        <span className="sr-only">ابحث في القواعد</span>
        <Search className="pointer-events-none absolute start-3 h-4 w-4 text-muted" strokeWidth={2} aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بالنصّ أو الباب أو المورّد"
          className="min-h-11 w-full rounded-lg border border-line-input bg-raised ps-9 pe-3 text-sm sm:min-h-9"
        />
      </label>

      {shown.length === 0 ? (
        <p className="text-xs text-muted">لا قاعدة تطابق «{q}».</p>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <bdi className="block truncate text-[13px] font-bold" dir="auto">{r.pattern}</bdi>
                <span className="block truncate text-[11px] text-muted">
                  {r.categoryLabel}{r.supplier ? ` · ${r.supplier}` : ""}{r.note ? ` · ${r.note}` : ""}
                </span>
              </span>
              {canEdit && (asking === r.id ? (
                <span className="flex flex-wrap gap-1.5">
                  <button type="button" disabled={busy} className={buttonClass("danger", "sm")} onClick={() => void remove(r)}>
                    {busy ? "يحذف…" : "نعم، احذفها"}
                  </button>
                  <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(null)}>إلغاء</button>
                </span>
              ) : (
                <button type="button" className={buttonClass("quiet", "sm")} onClick={() => setAsking(r.id)}>احذفها</button>
              ))}
            </li>
          ))}
        </ul>
      )}

      {!q && matched.length > FIRST && (
        <button type="button" onClick={() => setAll((v) => !v)} className={buttonClass("secondary", "sm")}>
          {all ? "اعرض أقلّ" : <>اعرض الكلّ (<span className="nums">{matched.length}</span>)</>}
        </button>
      )}
    </div>
  );
}
