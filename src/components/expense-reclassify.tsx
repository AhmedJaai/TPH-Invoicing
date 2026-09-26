"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Money } from "./money";
import { buttonClass } from "./ui";
import { toast } from "./ui-client";
import { postJson } from "@/lib/http-client";
import { txHref } from "@/lib/inspector";

/**
 * تصحيحُ التصنيف في موضع التنبيه.
 *
 * كان التنبيه يسمّي البنود ثمّ يفتح صفحة البنك — **ينقل ولا يُصلح**. والنظام
 * يعرف الجواب أصلاً: الحركة تحمل اسم مورّدٍ مسجَّل وقد صُنّفت راتباً أو
 * أجراً. فالاقتراح «سدادُ مورّد» معلوم، ولا ينقص إلّا تأكيدُ إنسان — ويصير
 * ذاكرةً بالمسار نفسه الذي يمرّ به تعريفُ الجهة في الطابور، لا بمسارٍ ثانٍ.
 *
 * ولا يُكتَب شيء بلا ضغطة: الاقتراح يُعرَض، والإنسان يقرّر.
 */

export interface Suspect {
  id: string;
  label: string;
  amountMinor: number;
  categoryLabel: string;
  supplier: string;
  supplierId: string | null;
  bankTransactionId: string | null;
}

export function ExpenseReclassify({ suspects }: { suspects: Suspect[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function fix(s: Suspect) {
    if (!s.bankTransactionId || !s.supplierId) return;
    setBusy(s.id);
    setError(null);
    try {
      /*
        ومعرّفُ المورّد يُرسَل لا اسمُه وحده — النظام يعرفه (به طابق البند)،
        فطلبُه من صاحب العمل سؤالٌ عمّا يُطرَح جوابُه.
      */
      const r = await postJson<{ message?: string }>("/api/counterparty", {
        transactionId: s.bankTransactionId,
        kind: "SUPPLIER",
        supplierId: s.supplierId,
        displayName: s.supplier,
      });
      if (!r.ok) {
        setError({ id: s.id, message: r.error });
        return;
      }
      const message = r.data.message ?? "صُنّفت سداد مورّد";
      setDone((d) => new Map(d).set(s.id, message));
      toast({ tone: "ok", title: message, body: "ويسري على أمثالها في الكشوف القادمة." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised">
      {suspects.map((s) => {
        const finished = done.get(s.id);
        return (
          <li key={s.id} className={`px-4 py-3 ${finished ? "bg-ok-bg" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold" dir="auto">{s.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted">
                  مصنَّفة «{s.categoryLabel}» · تحمل اسم المورّد «{s.supplier}»
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-bold"><Money minor={s.amountMinor} /></span>
            </div>

            {finished ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-ok">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden /> {finished}
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  aria-busy={busy === s.id}
                  type="button"
                  disabled={busy === s.id || !s.bankTransactionId || !s.supplierId}
                  onClick={() => fix(s)}
                  className={buttonClass("primary", "sm")}
                >
                  {`صنّفها سداداً لـ«${s.supplier}»`}
                </button>
                {s.bankTransactionId && (
                  <Link href={txHref(s.bankTransactionId)} className="inline-flex min-h-11 items-center gap-1 text-[11px] font-bold text-ink-soft hover:text-accent sm:min-h-0">
                    افتح حركتها <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </Link>
                )}
                {!s.supplierId && <span className="text-[11px] text-muted">المورّد غير مسجَّل بمعرّفه — صنّفها من البنك.</span>}
              </div>
            )}

            {error?.id === s.id && (
              <p role="alert" className="mt-1.5 text-[11px] font-bold text-danger">{error.message}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
