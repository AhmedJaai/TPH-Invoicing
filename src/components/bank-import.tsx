"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";

interface Summary {
  bank: string; accountNumber?: string;
  periodStart?: string; periodEnd?: string;
  totalRows: number; operational: number; payments: number;
  matchedTransactions: number; matchedInvoices: number;
  supplierOnly: number; unknown: number; duplicateGroups: number;
  openInvoicesBefore: number; warnings: number;
}

interface Preview {
  summary: Summary;
  preview: { date: string; amountMinor: number; supplierName?: string; invoiceNumbers: string[]; kind: string }[];
  unknownTop: { date: string; amountMinor: number; description: string }[];
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="rounded-xl border border-line bg-raised px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`nums mt-0.5 text-lg font-bold ${cls}`}>{value}</p>
    </div>
  );
}

export function BankImport({ openInvoiceCount }: { openInvoiceCount: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const [busy, setBusy] = useState<"reading" | "applying" | null>(null);
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [markResult, setMarkResult] = useState<string | null>(null);

  const send = useCallback(async (file: File, apply: boolean) => {
    setBusy(apply ? "applying" : "reading");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      if (apply) body.append("apply", "true");
      const res = await fetch("/api/bank-import", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "فشل الاستيراد"); return; }
      if (apply) {
        setDone(`طوبقت ${json.summary.matchedInvoices} فاتورة من ${json.created} تحويلاً`);
        setData(null);
        router.refresh();
      } else {
        setData(json as Preview);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [router]);

  const markPaid = useCallback(async () => {
    if (!confirm(`سيُعتبر كل ما تبقّى مفتوحاً (${openInvoiceCount} فاتورة) مسدَّداً، ويُسجَّل ذلك باسمك في سجل التدقيق. متابعة؟`)) return;
    setMarking(true);
    setMarkResult(null);
    try {
      const res = await fetch("/api/mark-paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ throughMonth: new Date().toISOString().slice(0, 7), note: "إقرار المالك: سُدّدت قبل النظام" }),
      });
      const json = await res.json();
      setMarkResult(res.ok ? json.message : json.error);
      if (res.ok) router.refresh();
    } catch (e) {
      setMarkResult((e as Error).message);
    } finally {
      setMarking(false);
    }
  }, [openInvoiceCount, router]);

  return (
    <div className="space-y-8">
      {/* ── الخيار الأول: كشف البنك ── */}
      <section>
        <h2 className="text-base font-bold">الخيار الأوّل — اقرأ كشف البنك</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          الأدقّ: كل سداد مثبت بحركة بنكية بتاريخها ومبلغها. ارفع كشف الحساب بصيغة Excel،
          وسيُعرض عليك ما سيحدث قبل أن يُحفظ شيء.
        </p>

        <div
          onClick={() => inputRef.current?.click()}
          className="mt-3 cursor-pointer rounded-xl border-2 border-dashed border-line px-5 py-8 text-center hover:border-ink-soft"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { fileRef.current = f; void send(f, false); }
            }}
          />
          <p className="text-sm font-bold">
            {busy === "reading" ? "يقرأ الكشف…" : "اختر ملف كشف الحساب"}
          </p>
          <p className="mt-1 text-xs text-muted">Excel من بنكك — لا يُحفظ شيء قبل مراجعتك</p>
        </div>

        {error && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}
        {done && <p className="mt-3 rounded-lg bg-ok-bg px-3 py-2 text-xs font-bold text-ok">✓ {done}</p>}

        {data && (
          <div className="mt-4 rounded-xl border border-line bg-raised p-4">
            <p className="text-xs text-muted">
              {data.summary.bank} · حساب {data.summary.accountNumber ?? "—"} ·{" "}
              {data.summary.periodStart} إلى {data.summary.periodEnd}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="حركات الكشف" value={String(data.summary.totalRows)} />
              <Stat label="مدفوعات محتملة" value={String(data.summary.payments)} />
              <Stat label="ستُطابق فواتير" value={String(data.summary.matchedInvoices)} tone="ok" />
              <Stat label="حركات مجهولة" value={String(data.summary.unknown)} tone={data.summary.unknown ? "warn" : undefined} />
            </div>

            {data.summary.duplicateGroups > 0 && (
              <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">
                ⚠ {data.summary.duplicateGroups} مجموعة يُشتبه بتكرار دفعها — راجعها بعد الاستيراد
              </p>
            )}

            {data.preview.length > 0 && (
              <>
                <p className="mt-4 text-xs font-bold">عيّنة ممّا سيُطابق</p>
                <ul className="mt-1.5 divide-y divide-line">
                  {data.preview.slice(0, 8).map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="min-w-0 truncate">
                        <span className="nums text-muted" dir="ltr">{p.date}</span>{" "}
                        {p.supplierName} — {p.invoiceNumbers.length} فاتورة
                      </span>
                      <span className="nums shrink-0 font-medium" dir="ltr">
                        {formatRiyalsDisplay(p.amountMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {data.unknownTop.length > 0 && (
              <>
                <p className="mt-4 text-xs font-bold text-warn">أكبر الحركات المجهولة</p>
                <p className="text-[11px] text-muted">
                  لم يُعرف المستفيد. أضف اسمه البنكي إلى المورّد ليُطابَق مستقبلاً.
                </p>
                <ul className="mt-1.5 divide-y divide-line">
                  {data.unknownTop.slice(0, 6).map((u, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="min-w-0 truncate text-ink-soft" dir="ltr">{u.description}</span>
                      <span className="nums shrink-0" dir="ltr">{formatRiyalsDisplay(u.amountMinor)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <button
              onClick={() => fileRef.current && send(fileRef.current, true)}
              disabled={busy !== null}
              className="mt-4 w-full rounded-lg bg-inverse-surface px-4 py-2.5 text-sm font-bold text-inverse-ink disabled:opacity-40"
            >
              {busy === "applying" ? "يطبّق…" : "اعتمد وطابِق"}
            </button>
          </div>
        )}
      </section>

      {/* ── الخيار الثاني: الوسم اليدوي ── */}
      <section className="border-t border-line pt-8">
        <h2 className="text-base font-bold">الخيار الثاني — اعتبرها مسدَّدة</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          أسرع، وأقلّ دقّة. تُعتبر كل الفواتير المفتوحة مسدَّدة بإقرارك أنت — ويُسجَّل
          في سجل التدقيق أنّ مصدر السداد إقرارك لا مطابقة بنكية، فلا يلتبس الأمر على
          من يراجع لاحقاً.
        </p>

        <div className="mt-3 rounded-xl border border-warn/40 bg-warn-bg p-4">
          <p className="text-sm font-bold text-warn">{openInvoiceCount} فاتورة مفتوحة الآن</p>
          <button
            onClick={markPaid}
            disabled={marking || openInvoiceCount === 0}
            className="mt-3 rounded-lg border border-warn/60 px-4 py-2 text-xs font-bold text-warn disabled:opacity-40"
          >
            {marking ? "يعتمد…" : "اعتبرها كلّها مسدَّدة"}
          </button>
          {markResult && <p className="mt-2 text-xs text-ink-soft">{markResult}</p>}
        </div>
      </section>
    </div>
  );
}
