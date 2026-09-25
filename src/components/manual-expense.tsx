"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Plus, TriangleAlert } from "lucide-react";
import { postJson } from "@/lib/http-client";
import { parseRiyals } from "@/lib/money";
import { CATEGORY_LABEL, type TxCategory } from "@/lib/bank/rules";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { Money } from "./money";
import { buttonClass, type ButtonVariant } from "./ui-tokens";
import { Sheet, toast } from "./ui-client";

const CATEGORIES: TxCategory[] = ["RENT", "SALARY", "UTILITY", "GOVERNMENT", "ZAKAT", "OTHER"];

/**
 * قيدُ مصروفٍ دُفع خارج البنك.
 *
 * الصفحة تقول عن المصروف المتوقَّع الذي لم يظهر في الكشف «قد يكون دُفع
 * نقداً» — فالقيدُ هنا في ورقةٍ بحقولٍ مسمّاة، يُفحَص فيها المبلغ قبل
 * الإرسال، ويبقى ما كُتب إن ردّه الخادم. والمبلغُ يُرسَل نصّاً كما كُتب،
 * والخادمُ يحوّله هللاتٍ بنفسه — لا عددَ عشريّاً بين الطرفين.
 *
 * وضغطتان على «قيّده» كانتا مصروفين: الخادمُ يردّ الثانيةَ (٤٠٩) ويسأل،
 * وهنا يُعرَض سؤالُه بزرٍّ صريح «هو مصروفٌ ثانٍ» لا بإعادة المحاولة.
 */
export function ManualExpense({ variant = "primary" }: { variant?: ButtonVariant }) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(todayInRiyadh());
  const [category, setCategory] = useState<TxCategory>("OTHER");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);

  const minor = amount.trim() ? parseRiyals(amount) : null;
  const problems = {
    label: label.trim().length < 2 ? "اكتب ما دُفع له — حرفان على الأقلّ." : null,
    amount: !amount.trim() ? "اكتب المبلغ." : minor === null || minor <= 0 ? "مبلغٌ لا يُقرأ — اكتبه أرقاماً مثل 350 أو 1,250.50" : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(occurredOn) ? null : "اختر تاريخ الدفع.",
  };
  const valid = !problems.label && !problems.amount && !problems.date;

  function close() {
    if (busy) return;
    setOpen(false);
    setError(null);
    setDuplicate(null);
    setTried(false);
  }

  async function save(confirmDuplicate = false) {
    setTried(true);
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await postJson<{ message?: string; duplicateOf?: string }>("/api/expense-actual", {
        action: "record", label: label.trim(), amount, occurredOn, category, confirmDuplicate,
      });
      if (!r.ok) {
        if (r.status === 409 && typeof r.data.duplicateOf === "string") setDuplicate(r.error);
        else setError(r.error);
        return;
      }
      toast({ tone: "ok", title: r.data.message ?? "قُيّد المصروف", body: "ويظهر في شهره أدناه — وله زرُّ حذفٍ إن قُيّد خطأً." });
      setLabel("");
      setAmount("");
      setDuplicate(null);
      setTried(false);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 block min-h-11 w-full rounded-lg border bg-raised px-3 text-sm sm:min-h-10";
  const border = (bad: string | null) => (tried && bad ? "border-danger" : "border-line-input");

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, "sm")}>
        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        قيّد مصروفاً نقدياً
      </button>

      <Sheet
        open={open}
        onClose={close}
        title="مصروفٌ دُفع خارج البنك"
        description="نقداً أو من حسابٍ آخر — ما لا يظهر في كشف البنك فلا يُشتقّ منه."
        size="sm"
        footer={
          duplicate ? (
            <>
              <button type="button" className={buttonClass("quiet")} disabled={busy} onClick={() => setDuplicate(null)}>لا — لا تقيّده</button>
              <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => save(true)}>
                {busy ? "يقيّد…" : "نعم — مصروفٌ ثانٍ، قيّده"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={buttonClass("quiet")} disabled={busy} onClick={close}>إلغاء</button>
              <button type="button" className={buttonClass("primary")} disabled={busy} onClick={() => save(false)}>
                {busy ? "يقيّد…" : "قيّده"}
              </button>
            </>
          )
        }
      >
        <form
          noValidate
          onSubmit={(e) => { e.preventDefault(); void save(false); }}
          className="space-y-4"
        >
          <label className="block">
            <span className="text-xs font-bold">البند</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="مثلاً: صيانة المكيّف"
              dir="auto"
              aria-invalid={tried && !!problems.label}
              aria-describedby={`${ids}-label`}
              className={`${field} ${border(problems.label)}`}
            />
            {tried && problems.label && <span id={`${ids}-label`} className="mt-1 block text-[11px] font-bold text-danger">{problems.label}</span>}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold">المبلغ (ر.س)</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                dir="ltr"
                aria-invalid={tried && !!problems.amount}
                aria-describedby={`${ids}-amount`}
                className={`nums ${field} ${border(problems.amount)}`}
              />
              {tried && problems.amount
                ? <span id={`${ids}-amount`} className="mt-1 block text-[11px] font-bold text-danger">{problems.amount}</span>
                : minor !== null && minor > 0 && <span id={`${ids}-amount`} className="mt-1 block text-[11px] text-muted">يُقيَّد <Money minor={minor} /> ريالاً</span>}
            </label>
            <label className="block">
              <span className="text-xs font-bold">تاريخ الدفع</span>
              <input
                type="date"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                dir="ltr"
                aria-invalid={tried && !!problems.date}
                className={`nums ${field} ${border(problems.date)}`}
              />
              {tried && problems.date && <span className="mt-1 block text-[11px] font-bold text-danger">{problems.date}</span>}
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold">الباب</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as TxCategory)} className={`${field} border-line-input`}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <span className="mt-1 block text-[11px] text-muted">سدادُ المورّدين ليس هنا — محسوبٌ في المشتريات، وقيدُه مصروفاً يضاعفه.</span>
          </label>

          {/* زرٌّ مخفيّ كي يُرسَل النموذج بـEnter من أيّ حقل */}
          <button type="submit" className="sr-only" tabIndex={-1}>قيّده</button>
        </form>

        {duplicate && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-warn/25 bg-warn-bg px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
            <span><span className="font-bold text-warn">{duplicate}</span> — إن ضغطتَ مرّتين فلا تقيّده؛ وإن كانا مصروفين حقيقيّين فأكّد.</span>
          </p>
        )}
        {error && (
          <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2.5 text-xs font-bold text-danger">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            {error} — ما كتبتَه باقٍ، فأعد المحاولة.
          </p>
        )}
      </Sheet>
    </>
  );
}
