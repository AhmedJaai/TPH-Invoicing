"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";

export interface ArchivedStatement {
  id: string;
  supplierName: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  closingBalanceMinor: number;
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
}: {
  archived: ArchivedStatement[];
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [copied, setCopied] = useState(false);

  const send = useCallback(
    async (body: FormData, key: string) => {
      setBusy(key);
      setError(null);
      setResult(null);
      try {
        const res = await fetch("/api/statement-reconcile", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? "تعذّرت المطابقة");
          return;
        }
        setResult(json as Result);
        if (json.persisted) router.refresh();
      } catch (e) {
        setError((e as Error).message);
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
          <p className="mt-3 rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
            لا كشوف مؤرشفة بعد. ارفع كشف المورّد من الصفحة الرئيسية أوّلاً.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised">
            {archived.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.supplierName}</span>
                  <span className="nums block text-[11px] text-muted" dir="ltr">
                    {a.periodStart} → {a.periodEnd}
                    {a.lineCount > 0 && ` · ${a.lineCount} سطر مطابَق`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="nums text-sm font-bold" dir="ltr">
                    {formatRiyalsDisplay(a.closingBalanceMinor)}
                  </span>
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
              {result.supplier.nameAr} · {result.period.start} → {result.period.end}
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
                await navigator.clipboard.writeText(result.memo);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
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
