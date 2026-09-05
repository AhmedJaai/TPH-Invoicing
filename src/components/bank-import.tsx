"use client";


import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRiyalsDisplay } from "@/lib/money";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { ConfirmAction } from "@/components/ui-client";

interface Coverage {
  from: string | null;
  to: string | null;
  gaps: { start: string; end: string; days: number }[];
  overlaps: number;
  summary: string;
}

interface Summary {
  coverage?: Coverage;
  /** هل بلغ المحسِّن الحلّ الأمثل يقيناً، أم رجع إلى الجشع؟ */
  exact?: boolean;
  bank: string; accountNumber?: string;
  periodStart?: string; periodEnd?: string;
  totalRows: number; operational: number; payments: number;
  matchedTransactions: number; matchedInvoices: number;
  supplierOnly: number; unknown: number; duplicateGroups: number;
  openInvoicesBefore: number; warnings: number;
  classified: number;
  classifiedAmountMinor: number;
  byCategory: { category: string; label: string; count: number; amountMinor: number }[];
}

interface UnknownTx {
  id: string;
  date: string;
  amountMinor: number;
  description: string;
  suggestedAlias: string;
  suggestedCategory: TxCategory;
}

/** التصنيفات المعروضة — بلا UNKNOWN فهي الحالة لا خياراً. */
const CATEGORY_OPTIONS: TxCategory[] = [
  "SUPPLIER", "SALARY", "RENT", "ZAKAT", "UTILITY",
  "GOVERNMENT", "PERSONAL", "INTERNAL", "OTHER",
];

interface Preview {
  summary: Summary;
  preview: { date: string; amountMinor: number; supplierName?: string; invoiceNumbers: string[]; kind: string }[];
  unknown: UnknownTx[];
  supplierOnlyList: { date: string; amountMinor: number; supplierName: string }[];
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "";
  return (
    <div className="rounded-2xl border border-line bg-raised shadow-raised px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`nums mt-0.5 text-lg font-bold ${cls}`}>{value}</p>
    </div>
  );
}

/**
 * صفّ لحركة بنكية لم تُعرف.
 *
 * كشف الحساب ليس كلّه مورّدين: فيه رواتب وإيجار وزكاة وكهرباء وتحويلات
 * شخصية. وعرضها كلّها «مدفوعات مجهولة» يغرق النافع في الضجيج. فيصنّفها
 * المالك مرّة، وتصير قاعدةً تسري على ما يشبهها في كل كشف بعده.
 */
function UnknownRow({
  tx,
  suppliers,
  onLearned,
}: {
  tx: UnknownTx;
  suppliers: SupplierOption[];
  onLearned: () => void;
}) {
  const [category, setCategory] = useState<TxCategory>(
    tx.suggestedCategory === "UNKNOWN" ? "SUPPLIER" : tx.suggestedCategory,
  );
  const [supplierId, setSupplierId] = useState("");
  const [pattern, setPattern] = useState(tx.suggestedAlias);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const needsSupplier = category === "SUPPLIER";
  const ready = pattern.trim().length >= 3 && (!needsSupplier || Boolean(supplierId));

  const save = async () => {
    if (!ready) return;
    setState("saving");
    try {
      const res = await fetch("/api/bank-rule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pattern: pattern.trim(),
          category,
          supplierId: needsSupplier ? supplierId : undefined,
        }),
      });
      const json = await res.json();
      setMessage(json.message ?? json.error);
      setState(res.ok ? "saved" : "error");
      if (res.ok) onLearned();
    } catch (e) {
      setMessage((e as Error).message);
      setState("error");
    }
  };

  return (
    <li className={`px-3 py-2.5 ${state === "saved" ? "bg-ok-bg" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 truncate text-xs text-ink-soft" dir="ltr" title={tx.description}>
          {tx.description}
        </p>
        <span className="nums shrink-0 text-xs font-bold" dir="ltr">
          {formatRiyalsDisplay(tx.amountMinor)}
        </span>
        <span className="nums shrink-0 text-[11px] text-muted" dir="ltr">{tx.date}</span>
      </div>

      {state === "saved" ? (
        <p className="mt-1.5 text-[11px] font-bold text-ok">✓ {message}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as TxCategory)}
            className="min-w-[8rem] rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>

          {needsSupplier && (
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="min-w-[9rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
            >
              <option value="">اختر المورّد…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nameAr}</option>
              ))}
            </select>
          )}

          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="النصّ المميِّز في وصف الحركة"
            dir="auto"
            className="min-w-[9rem] flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-ink"
          />

          <button
            onClick={save}
            disabled={!ready || state === "saving"}
            className="shrink-0 rounded-lg bg-inverse-surface px-3 py-1.5 text-[11px] font-bold text-inverse-ink disabled:opacity-30"
          >
            {state === "saving" ? "يحفظ…" : "صنّفها"}
          </button>

          {state === "error" && message && (
            <p className="w-full text-[11px] text-danger">{message}</p>
          )}
        </div>
      )}
    </li>
  );
}


/**
 * خطوات الاستيراد، ظاهرةً.
 *
 * كان كل شيء في شاشة واحدة: الرفع والمعاينة والتصنيف والقواعد والتطبيق
 * والوسم اليدويّ. فلا يعرف المستخدم أين هو ولا كم بقي. والخطوة تُشتقّ
 * من الحال لا تُخزَّن — فحالٌ ثانية قد تخالف الأولى.
 */
const STEPS = ["ارفع الكشف", "يُقرأ", "راجع ما يحتاجك", "طبّق", "تمّ"] as const;

function Steps({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="خطوات الاستيراد">
      {STEPS.map((label, i) => (
        <li key={label} className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={`h-1 rounded-full ${
              i < current ? "bg-ink" : i === current ? "bg-ink/50" : "bg-sunken"
            }`}
          />
          <span
            className={`truncate text-[10px] ${
              i === current ? "font-bold text-ink" : "text-muted"
            }`}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function BankImport({
  openInvoiceCount,
  suppliers,
}: {
  openInvoiceCount: number;
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);
  const [busy, setBusy] = useState<"reading" | "applying" | null>(null);
  const [data, setData] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [markResult, setMarkResult] = useState<string | null>(null);
  /** كم اسماً بنكياً تعلّمه النظام في هذه الجلسة — يفتح زرّ إعادة المطابقة */
  const [learned, setLearned] = useState(0);

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
        setLearned(0);
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
  }, [router]);

  /*
    الخطوة الحالية تُشتقّ من الحال لا تُخزَّن.
    حالٌ ثانية تُخزَّن هي حالٌ ثانية قد تخالف الأولى.
  */
  const step = done ? 4 : data ? (data.summary.unknown > 0 ? 2 : 3) : busy === "reading" ? 1 : 0;

  return (
    <div className="space-y-8">
      {/* ── الخيار الأول: كشف البنك ── */}
      <section>
        <h2 className="font-display text-lg font-bold leading-tight">اقرأ كشف البنك</h2>
        <p className="mb-4 mt-1 max-w-2xl text-xs leading-relaxed text-ink-soft">
          الأدقّ: كل سداد مثبت بحركة بنكية بتاريخها ومبلغها. ولا يُحفظ شيء قبل أن
          تراه.
        </p>

        <Steps current={step} />

        <div
          onClick={() => inputRef.current?.click()}
          className="mt-3 cursor-pointer rounded-xl border-2 border-dashed border-line px-5 py-8 text-center hover:border-ink-soft"
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { fileRef.current = f; void send(f, false); }
            }}
          />
          <p className="text-sm font-bold">
            {busy === "reading" ? "يقرأ الكشف…" : "اختر ملف كشف الحساب"}
          </p>
          <p className="mt-1 text-xs text-muted">Excel أو PDF نصّيّ من بنكك — لا يُحفظ شيء قبل مراجعتك</p>
        </div>

        {error && <p className="mt-3 rounded-lg bg-danger-bg px-3 py-2 text-xs text-danger">{error}</p>}
        {done && <p className="mt-3 rounded-lg bg-ok-bg px-3 py-2 text-xs font-bold text-ok">✓ {done}</p>}

        {data && (
          <div className="mt-4 rounded-2xl border border-line bg-raised shadow-raised p-4">
            <p className="text-xs text-muted">
              {data.summary.bank} · حساب {data.summary.accountNumber ?? "—"} ·{" "}
              {data.summary.periodStart} إلى {data.summary.periodEnd}
            </p>

            {/*
              الفجوة تُعرَض قبل كل شيء: التكرار يُرفَض من نفسه، أمّا
              الأسبوع الذي لم يُستورَد فلا يشكو منه أحد — الغائب لا يُرى.
            */}
            {data.summary.coverage && data.summary.coverage.gaps.length > 0 && (
              <div className="mt-3 rounded-xl border border-warn/40 bg-warn-bg px-3 py-2.5">
                <p className="text-xs font-bold text-warn">
                  فجوة في التغطية — أيامٌ لم يُستورَد كشفها
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {data.summary.coverage.gaps.slice(0, 4).map((g, i) => (
                    <li key={i} className="nums text-[11px] leading-relaxed">
                      {g.start} ← {g.end} ({g.days} يوماً)
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] leading-relaxed text-ink-soft">
                  حركات هذه الأيام غائبة عن النظام، ولن تظهر ناقصةً في أي تقرير — لأنّ
                  الغائب لا يُرى. ارفع كشفها لتكتمل.
                </p>
              </div>
            )}

            {/*
              الحلّ التقريبيّ يُعلَن.

              حين تنفد ميزانيّة العقد يرجع المحسِّن إلى الجشع، فيُنتج
              توزيعاً جيّداً لا أفضل. وكان هذا يُحسَب ولا يُعرَض — فتقول
              الشاشة عن حلٍّ تقريبيّ ما تقوله عن حلٍّ مثبت. والقرار نفسه
              يحتاط فيصير التلقائيّ اقتراحاً، لكنّ من يرى الاقتراحات
              كثُرت فجأةً يستحقّ أن يعرف لماذا.
            */}
            {data.summary.exact === false && (
              <div className="mt-3 rounded-xl border border-warn/40 bg-warn-bg px-3 py-2.5">
                <p className="text-xs font-bold text-warn">
                  التوزيع تقريبيّ — لا مثبت
                </p>
                <p className="mt-1.5 text-[10px] leading-relaxed text-ink-soft">
                  الاحتمالات في هذا الكشف أكثر من أن تُستقصى كلّها، فتوقّف البحث عند
                  أفضل ما بلغه. والتوزيع المعروض صحيحٌ ومتّسق، لكن قد يوجد توزيعٌ أنسب
                  لم يُبلَغ — ولذلك لم تُطابَق حركةٌ تلقائياً هنا: صارت كلّها اقتراحاً
                  ينتظر إقرارك. راجعها بعينك.
                </p>
              </div>
            )}

            {/*
              الرقم الأوّل هو ما يحتاج المستخدم، لا مجموع ما في الملف.
              من يرى «٢٤٣ حركة» يظنّ أنّ عليه مراجعة مئتين وأربعين، وإنّما
              عليه اثنتا عشرة.
            */}
            <p className="mt-3 font-display text-2xl font-bold leading-none">
              {data.summary.unknown === 0
                ? "لا شيء يحتاجك"
                : `${data.summary.unknown} حركة تحتاجك`}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              من <span className="nums">{data.summary.totalRows}</span> حركة —
              الباقي صُنّف بقواعدك أو بطبيعته.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="حركات الكشف" value={String(data.summary.totalRows)} />
              <Stat label="مدفوعات محتملة" value={String(data.summary.payments)} />
              <Stat label="ستُطابق فواتير" value={String(data.summary.matchedInvoices)} tone="ok" />
              <Stat label="تحتاجك" value={String(data.summary.unknown)} tone={data.summary.unknown ? "warn" : undefined} />
            </div>

            {data.summary.byCategory.filter((c) => c.category !== "UNKNOWN" && c.category !== "SUPPLIER").length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-bold">حركات صنّفتَها سابقاً</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {data.summary.byCategory
                    .filter((c) => c.category !== "UNKNOWN" && c.category !== "SUPPLIER")
                    .map((c) => (
                      <li key={c.category} className="rounded-lg border border-line px-2 py-1 text-[11px]">
                        {c.label}: {c.count} ·{" "}
                        <span className="nums" dir="ltr">{formatRiyalsDisplay(c.amountMinor)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

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

            {data.unknown.length > 0 && (
              <>
                <p className="mt-5 text-xs font-bold text-warn">
                  {data.unknown.length} حركة لم يُعرف مستفيدها
                </p>
                <p className="text-[11px] leading-relaxed text-muted">
                  ليست كلّها مورّدين: فيها رواتب وإيجار وزكاة وكهرباء وتحويلاتك الشخصية.
                  صنّف كلّ حركة مرّة واحدة — يُحفظ التصنيف قاعدةً تسري على ما يشبهها في كل
                  كشف بعده، فتُخرَج من حساب مستحقّات المورّدين.
                  {learned > 0 && ` — صُنّف ${learned} حتى الآن.`}
                </p>

                <ul className="mt-2 max-h-[26rem] divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {data.unknown.map((u) => (
                    <UnknownRow
                      key={u.id}
                      tx={u}
                      suppliers={suppliers}
                      onLearned={() => setLearned((n) => n + 1)}
                    />
                  ))}
                </ul>

                {learned > 0 && (
                  <button
                    onClick={() => fileRef.current && send(fileRef.current, false)}
                    disabled={busy !== null}
                    className="mt-2 w-full rounded-lg border border-line px-4 py-2 text-xs font-bold hover:border-ink-soft disabled:opacity-40"
                  >
                    {busy === "reading" ? "يعيد المطابقة…" : "أعد المطابقة بالأسماء الجديدة"}
                  </button>
                )}
              </>
            )}

            {data.supplierOnlyList.length > 0 && (
              <>
                <p className="mt-5 text-xs font-bold">عُرف المورّد ولم تُطابَق فاتورة</p>
                <p className="text-[11px] text-muted">
                  تحويل إلى مورّد معروف لا تفسّره فاتورة مفتوحة — إمّا سُدّدت سلفاً أو لم تُرفع فاتورتها.
                </p>
                <ul className="mt-1.5 divide-y divide-line">
                  {data.supplierOnlyList.slice(0, 8).map((u, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                      <span className="min-w-0 truncate">{u.supplierName}</span>
                      <span className="nums shrink-0 text-muted" dir="ltr">{u.date}</span>
                      <span className="nums shrink-0 font-medium" dir="ltr">
                        {formatRiyalsDisplay(u.amountMinor)}
                      </span>
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

      {/*
        ── طريقة سداد أخرى ──

        هذا الفعل لا يُثبت أنّ مالاً خرج، بل يُثبت أنّك قلتَ إنّه خرج.
        وكان زرّاً عادياً بجانب مسار البنك فبدا خياراً ثانياً كالأوّل.

        (وقد أُعيد هذا الحارس بعد أن ضاع في إعادة كتابة المكوّن معالِجاً —
        فالارتداد في فعلٍ خطر أسوأ من غيابه ابتداءً.)
      */}
      <section className="border-t border-line pt-8">
        <h2 className="font-display text-lg font-bold leading-tight">طريقة سداد أخرى</h2>
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-ink-soft">
          حين تُدفع الفواتير نقداً أو من حساب لا يصل كشفه، تُعلن سدادها بنفسك.
          ويُسجَّل في سجل التدقيق أنّ مصدر السداد إقرارك لا مطابقة بنكية، فلا يلتبس
          الأمر على من يراجع لاحقاً.
        </p>

        <div className="mt-4">
          <p className="mb-3 text-sm font-bold">
            <span className="nums">{openInvoiceCount}</span> فاتورة مفتوحة الآن
          </p>
          <ConfirmAction
            label="أعلن سدادها يدوياً"
            variant="secondary"
            disabled={marking || openInvoiceCount === 0}
            title={`ستُعتبر ${openInvoiceCount} فاتورة مسدَّدة بإقرارك`}
            consequence="هذا لا يُثبت سداداً بنكياً. لن تظهر هذه الفواتير في المستحقّات بعدها، وسيحمل سجل التدقيق اسمك مصدراً وحيداً للسداد."
            acknowledgement="أفهم أنّ هذا إقرارٌ منّي لا مطابقةٌ بنكية."
            confirmLabel="أعلن سدادها"
            onConfirm={markPaid}
          />
          {markResult && <p className="mt-3 text-xs text-ink-soft">{markResult}</p>}
        </div>
      </section>
    </div>
  );
}
