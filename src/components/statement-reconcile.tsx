"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { request } from "@/lib/http-client";
import { LINE, countNoun } from "@/lib/arabic";
import { formatRange } from "@/lib/riyadh-time";

export interface ArchivedStatement {
  id: string;
  supplierName: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  /** `null` تعني «لم يُقرأ» — وتُعرَض «غير معروف» لا صفراً. */
  closingBalanceMinor: number | null;
  lineCount: number;
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

interface Result {
  persisted: boolean;
  fileName: string;
  supplier: { id: string; nameAr: string };
  period: { start: string; end: string };
  summary: {
    statementLines: number; ourInvoices: number; matched: number;
    missingFromArchive: number; amountMismatches: number; notInStatement: number;
    theirBilledMinor: number; theirPaidMinor: number; ourBilledMinor: number;
    billedDifferenceMinor: number; balanceArithmeticOk: boolean | null;
  };
  missing: { date: string; ref: string; amountMinor: number }[];
  mismatches: { invoiceNumber: string; theirsMinor: number; oursMinor: number; differenceMinor: number }[];
  extra: { invoiceNumber: string; date: string; amountMinor: number }[];
  /** أسطرٌ لم يُقرأ مبلغها أو تاريخها — لم تُطابَق ولم تُحذف. */
  unreadLines?: { date: string; description: string; amountText: string }[];
  memo: string;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`nums mt-0.5 text-base font-bold ${cls}`}>{value}</p>
    </div>
  );
}

export function StatementReconcile({
  archived,
  suppliers,
  initialSupplierId,
}: {
  archived: ArchivedStatement[];
  suppliers: SupplierOption[];
  /** المورّد الذي فُتحت الصفحة عليه من ملفّه — يُختار سلفاً في رفع الكشف. */
  initialSupplierId?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState(initialSupplierId ?? "");
  const [copied, setCopied] = useState(false);

  const send = useCallback(
    async (body: FormData, key: string) => {
      setBusy(key);
      setError(null);
      setResult(null);
      try {
        const r = await request<Result & { persisted?: boolean }>("/api/statement-reconcile", { method: "POST", body });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setResult(r.data);
        if (r.data.persisted) router.refresh();
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const s = result?.summary;

  return (
    <div className="space-y-8">
      {/* ── كشوف مؤرشفة ── */}
      <section>
        <h2 className="text-base font-bold">كشوف مؤرشفة في الدرايف</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          يُقرأ محتوى الكشف وتُقابَل سطوره بفواتيرك، ويُحفظ الناتج مع تنبيهاته.
        </p>

        {archived.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
            لا كشوف مؤرشفة بعد. ارفع كشف المورّد من صفحة الرفع (/upload) أوّلاً.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
            {archived.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.supplierName}</span>
                  <span className="block text-[11px] text-muted" dir="auto">
                    {formatRange(a.periodStart, a.periodEnd)}
                    {a.lineCount > 0
                      ? ` · ${countNoun(a.lineCount, LINE)} مطابَقة`
                      : " · بلا أسطر — طابِقه لتُقرأ"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  {a.closingBalanceMinor === null ? (
                    <span className="text-sm font-bold text-muted">غير معروف</span>
                  ) : (
                    <span className="nums text-sm font-bold" dir="ltr">
                      {formatRiyalsDisplay(a.closingBalanceMinor)}
                    </span>
                  )}
                  <button
                    onClick={() => {
                      const f = new FormData();
                      f.append("statementId", a.id);
                      void send(f, a.id);
                    }}
                    disabled={busy !== null}
                    className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold hover:border-ink-soft disabled:opacity-40"
                  >
                    {busy === a.id ? "يقرأ ويطابق…" : a.lineCount > 0 ? "أعد المطابقة" : "طابِق"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── كشف وصل توّاً ── */}
      <section className="border-t border-line pt-8">
        <h2 className="text-base font-bold">كشف وصلك الآن</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          للفحص السريع قبل الأرشفة — يُقرأ ويُطابَق ويُعرض، ولا يُحفظ منه شيء.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="المورّد صاحب الكشف"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="min-w-[11rem] flex-1 rounded-lg border border-line bg-surface px-2.5 py-2 text-xs outline-none focus:border-ink"
          >
            <option value="">المورّد: يُستنتج من الكشف</option>
            {suppliers.map((x) => (
              <option key={x.id} value={x.id}>{x.nameAr}</option>
            ))}
          </select>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
            className="rounded-lg bg-inverse-surface px-4 py-2 text-xs font-bold text-inverse-ink disabled:opacity-40"
          >
            {busy === "upload" ? "يقرأ…" : "اختر ملف الكشف"}
          </button>
          <input
            ref={inputRef}
            aria-label="ملفّ كشف المورّد"
            type="file"
            accept=".pdf,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const body = new FormData();
              body.append("file", f);
              if (supplierId) body.append("supplierId", supplierId);
              void send(body, "upload");
            }}
          />
        </div>
      </section>

      {error && <p className="rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}

      {/* ── النتيجة ── */}
      {result && s && (
        <section className="border-t border-line pt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold">
              {result.supplier.nameAr} · <bdi className="nums">{result.period.start}</bdi> إلى <bdi className="nums">{result.period.end}</bdi>
            </h2>
            {result.persisted && <span className="text-[11px] font-bold text-ok">✓ حُفظ الناتج</span>}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="سطور كشفه" value={String(s.statementLines)} />
            <Stat label="طوبقت" value={String(s.matched)} tone="ok" />
            <Stat
              label="حمّلها ولا ملف لها"
              value={String(s.missingFromArchive)}
              tone={s.missingFromArchive ? "danger" : "ok"}
            />
            <Stat
              label="فروق مبالغ"
              value={String(s.amountMismatches)}
              tone={s.amountMismatches ? "warn" : "ok"}
            />
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="ما حمّله علينا" value={formatRiyalsDisplay(s.theirBilledMinor)} />
            <Stat label="ما لدينا من فواتيره" value={formatRiyalsDisplay(s.ourBilledMinor)} />
            <Stat
              label="الفرق"
              value={formatRiyalsDisplay(Math.abs(s.billedDifferenceMinor))}
              tone={s.billedDifferenceMinor === 0 ? "ok" : "warn"}
            />
            <Stat label="ما سدّدناه في كشفه" value={formatRiyalsDisplay(s.theirPaidMinor)} />
          </div>

          {result.unreadLines && result.unreadLines.length > 0 && (
            <div className="mt-3 rounded-lg border border-warn/40 bg-warn-bg px-3 py-2">
              <p className="text-xs font-bold text-warn">
                {countNoun(result.unreadLines.length, LINE)} في كشفه لم يُقرأ مبلغه أو تاريخه — لم تُطابَق
                ولم تُحذف، فراجعها في الكشف نفسه
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.unreadLines.slice(0, 12).map((u, i) => (
                  <li key={i} className="text-[11px] text-ink-soft" dir="auto">
                    <bdi className="nums">{u.date || "بلا تاريخ"}</bdi> · {u.description || "بلا وصف"} ·{" "}
                    <bdi className="nums">{u.amountText || "بلا مبلغ"}</bdi>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {s.balanceArithmeticOk === false && (
            <p className="mt-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
              ⚠ حساب الكشف نفسه لا يستقيم: الافتتاحي مع الحركات لا يعطي الرصيد الختامي المكتوب فيه.
            </p>
          )}

          {result.missing.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-bold text-danger">
                فواتير حمّلها عليك ولا ملف لها عندك — {result.missing.length}
              </h3>
              <p className="text-[11px] leading-relaxed text-muted">
                هذه هي الفائدة الكبرى من مقابلة الكشف: فاتورة ناقصة لا يكشفها تفتيش أرشيفك،
                لأنّها ليست فيه.
              </p>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-danger/40">
                {result.missing.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 bg-danger-bg px-3 py-2 text-xs">
                    <span className="nums shrink-0 text-muted" dir="ltr">{m.date}</span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">{m.ref}</span>
                    <span className="nums shrink-0 font-bold text-danger" dir="ltr">
                      {formatRiyalsDisplay(m.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.mismatches.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-bold text-warn">فروق في المبالغ</h3>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-warn/40">
                {result.mismatches.map((m, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 bg-warn-bg px-3 py-2 text-xs">
                    <span className="font-mono" dir="ltr">{m.invoiceNumber}</span>
                    <span className="nums" dir="ltr">
                      عنده {formatRiyalsDisplay(m.theirsMinor)} · عندنا {formatRiyalsDisplay(m.oursMinor)}
                    </span>
                    <span className="nums font-bold text-warn" dir="ltr">
                      {m.differenceMinor > 0 ? "+" : ""}{formatRiyalsDisplay(m.differenceMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.extra.length > 0 && (
            <>
              <h3 className="mt-6 text-sm font-bold">فواتير عندك لم ترد في كشفه — {result.extra.length}</h3>
              <p className="text-[11px] text-muted">
                تحقّق أنّها ليست مكرّرة عندك، ولا تخصّ مورّداً آخر.
              </p>
              <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-raised">
                {result.extra.slice(0, 15).map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                    <span className="font-mono" dir="ltr">{m.invoiceNumber}</span>
                    <span className="nums text-muted" dir="ltr">{m.date}</span>
                    <span className="nums font-medium" dir="ltr">{formatRiyalsDisplay(m.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* ── مذكّرة الفروق ── */}
          <h3 className="mt-6 text-sm font-bold">مذكّرة جاهزة للمورّد</h3>
          <pre
            dir="rtl"
            className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-sunken p-3 text-[11px] leading-relaxed"
          >
            {result.memo}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={async () => {
                /* رفضُ إذن الحافظة يُسمَع ولا يمرّ صامتاً */
                try {
                  await navigator.clipboard.writeText(result.memo);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError("تعذّر النسخ — المتصفّح منع الوصول إلى الحافظة. حدّد نصّ المذكّرة وانسخه بيدك.");
                }
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold hover:border-ink-soft"
            >
              {copied ? "✓ نُسخت" : "انسخ المذكّرة"}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(result.memo)}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold hover:border-ink-soft"
            >
              أرسلها واتساب
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
