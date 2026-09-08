"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Money } from "./money";

/**
 * تصحيحُ التصنيف في موضع التنبيه.
 *
 * ── لماذا لا يكفي الرابط ──
 *
 * كان التنبيه يسمّي البنود ثمّ يفتح صفحة البنك. وهي **تنقل ولا تُصلح**:
 * يصل صاحبُ العمل إلى شاشةٍ فيها مئات الحركات، ويبحث عن البند، ثمّ
 * يفعل هناك ما كان يمكن أن يقع هنا بضغطة.
 *
 * والنظام يعرف الجواب أصلاً: هذه الحركة تحمل اسم مورّدٍ مسجَّل عندنا،
 * وقد صُنّفت راتباً أو أجراً. فالاقتراح معلوم — «سدادُ مورّد» — ولا
 * ينقص إلّا تأكيدُ إنسان.
 *
 * ── وما يقع بالضغطة ──
 *
 * تُصنَّف الحركة سداد مورّد، **ويصير ذلك ذاكرةً** تسري على أمثالها في
 * الكشوف السابقة والقادمة — وهو المسار نفسه الذي يمرّ به تعريفُ الجهة
 * في طابور المراجعة، لا مسارٌ ثانٍ يفعل الشيء نفسه بطريقةٍ أخرى.
 *
 * ولا يُكتَب شيء بلا ضغطة: الاقتراح يُعرَض، والإنسان يقرّر.
 */

export interface Suspect {
  id: string;
  label: string;
  amountMinor: number;
  categoryLabel: string;
  supplier: string;
  bankTransactionId: string | null;
}

export function ExpenseReclassify({ suspects }: { suspects: Suspect[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  async function fix(s: Suspect) {
    if (!s.bankTransactionId) return;
    setBusy(s.id);
    setError(null);

    let res: Response;
    try {
      res = await fetch("/api/counterparty", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactionId: s.bankTransactionId,
          kind: "SUPPLIER",
          displayName: s.supplier,
        }),
      });
    } catch {
      /* لم يصل الطلب أصلاً — وهذا وحده عطبُ شبكة */
      setError({ id: s.id, message: "تعذّر الاتصال بالخادم — لم يصل الطلب." });
      setBusy(null);
      return;
    }

    /* يُقرأ نصّاً قبل ادّعاء أنّه JSON — صفحةُ الخطأ ليست JSON */
    const text = await res.text().catch(() => "");
    let data: { message?: string; error?: string } = {};
    try {
      data = text ? (JSON.parse(text) as typeof data) : {};
    } catch {
      /* ليس JSON */
    }

    if (!res.ok) {
      setError({
        id: s.id,
        message: data.error ?? `تعذّر الحفظ — ردّ الخادم بالرمز ${res.status}`,
      });
      setBusy(null);
      return;
    }

    setDone((d) => new Map(d).set(s.id, data.message ?? "صُنّفت سداد مورّد"));
    setBusy(null);
    router.refresh();
  }

  return (
    <ul className="mt-3 divide-y divide-line/60 rounded-lg border border-line/60 bg-surface/60">
      {suspects.map((s) => {
        const finished = done.get(s.id);
        return (
          <li key={s.id} className="px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{s.label}</span>
                <span className="block truncate text-[11px] text-muted">
                  مصنَّفة {s.categoryLabel} · تطابق المورّد «{s.supplier}»
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold">
                <Money minor={s.amountMinor} />
              </span>
            </div>

            {finished ? (
              <p className="mt-1.5 text-[11px] font-bold text-ok">✓ {finished}</p>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/*
                  الاقتراح يُقال قبل الضغط — والسياسة المخفيّة تُنتج
                  ثقةً بلا فهم.
                */}
                <span className="text-[11px] text-muted">
                  المقترَح: سدادُ مورّد لـ«{s.supplier}» — ويسري على أمثاله
                </span>
                <button
                  type="button"
                  disabled={busy === s.id || !s.bankTransactionId}
                  onClick={() => fix(s)}
                  className="rounded-lg bg-inverse-surface px-2.5 py-1 text-[11px] font-bold text-inverse-ink disabled:opacity-50"
                >
                  {busy === s.id ? "يحفظ…" : "صنّفها سداد مورّد"}
                </button>
                {s.bankTransactionId && (
                  <a href={`/bank#tx-${s.bankTransactionId}`} className="text-[11px] underline">
                    أو افتحها في البنك ←
                  </a>
                )}
              </div>
            )}

            {error?.id === s.id && (
              <p className="mt-1.5 text-[11px] font-bold text-danger">{error.message}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
