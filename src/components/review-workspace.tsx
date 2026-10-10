"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Money } from "./money";
import { Badge, buttonClass, Card, EmptyState } from "./ui";
import { toast } from "./ui-client";
import { countNoun, SUGGESTION, TRANSACTION } from "@/lib/arabic";
import { postJson } from "@/lib/http-client";
import { strength } from "@/lib/bank/strength";
import {
  BUCKET_HINT, BUCKET_LABEL, bulkConfirmable,
  settleable, groupForReview,
  type ReviewBucket, type ReviewItem,
} from "@/lib/bank/review-queue";
import { ACT, recordBatch } from "@/lib/ui-terms";
import { formatDay } from "@/lib/riyadh-time";
import { txHref } from "@/lib/inspector";
import { SupplierPicker } from "./supplier-picker";

/**
 * طابور المراجعة الموحَّد.
 *
 * كان ما ينتظر قرار الإنسان مبعثراً: بعضُه في «البنك»، وبعضُه في «ما
 * يحتاج انتباهك»، وبعضُه لا يظهر إلّا في نتيجة الاستيراد فيضيع بإغلاق
 * الشاشة. فلا يعرف صاحب العمل كم بقي عليه، ولا يرى عملَه ينقص.
 *
 * وهنا **ثلاثة أعمالٍ مفصولة** لأنّها تحتاج ثلاثة أنواعٍ من الانتباه:
 * ما يُؤكَّد في ثوانٍ، وما يحتاج عيناً، وما يحتاج تعريفاً.
 *
 * ولكلّ بندٍ **فعلُه**. وكانت الشاشة تعرض ثلاث قوائم بلا زرٍّ واحد:
 * ‏«يُراجَع» توصف بأنّها «تحتاج عينك» ولا تُعطي العين ما تفعله،
 * و«يُحسَم» توصف بأنّ «تعريفَها يسري على أمثالها» ولا موضع فيها للتعريف.
 * فكانت الصفحة تَعُدّ العمل ولا تُنقصه — وهو أسوأ من ألّا تكون.
 */

type RowMode = "reject" | "define" | "pick";

/** مرشّحٌ كما يحسبه الخادم الآن — `/api/match-candidates`. */
interface CandidateView {
  key: string;
  invoiceIds: string[];
  recommended: boolean;
  outcome: string;
  score: number;
  parts: { supplier: number; amount: number; date: number; reference: number | null };
  allocatedMinor: number;
  evidence: string[];
  invoices: { id: string; number: string | null; date: string | null; totalMinor: number | null; outstandingMinor: number | null }[];
}

export interface ReviewWorkspaceProps {
  items: ReviewItem[];
  /** هل يملك المستخدم صلاحية الإقرار؟ */
  canApprove: boolean;
  /** هل يملك صلاحية تعريف الجهات وتصنيفها؟ */
  canEdit: boolean;
  /** المورّدون — «سداد مورّد» بلا قائمةٍ يُختار منها زرٌّ يردّه الخادم. */
  suppliers?: readonly { id: string; nameAr: string }[];
}

/* لونُ الباب نقطةٌ بجانب اسمه — الاسمُ يحمل المعنى واللونُ يعين العين */
const BUCKET_DOT: Record<ReviewBucket, string> = {
  CONFIRM: "bg-ok",
  REVIEW: "bg-warn",
  RESOLVE: "bg-info",
};

/**
 * ما ردّه الإقرارُ الجماعيّ — كلُّ سببٍ بحركته: لمن، وبكم، ورابطُ ملفّها.
 * كان السببُ مجرّداً ويُقصّ عند ستّة، فمن رُدّت له تسعٌ لا يعرف أيَّها يقصد كلٌّ.
 */
function RejectedList({ rejected, items }: { rejected: { transactionId: string; reason: string }[]; items: ReviewItem[] }) {
  const [all, setAll] = useState(false);
  const byId = new Map(items.map((i) => [i.transactionId, i]));
  const shown = all ? rejected : rejected.slice(0, 6);
  return (
    <>
      <ul className="mt-1.5 space-y-1">
        {shown.map((r) => {
          const tx = byId.get(r.transactionId);
          return (
            <li key={r.transactionId} className="text-xs leading-relaxed text-ink-soft">
              <Link href={txHref(r.transactionId)} className="font-bold text-accent hover:underline" dir="auto">
                {tx ? (tx.beneficiary || tx.supplierName || tx.description.slice(0, 40) || "حركة") : "حركة"}
              </Link>
              {tx && <> · <Money minor={tx.amountMinor} /></>}
              {" — "}{r.reason}
            </li>
          );
        })}
      </ul>
      {rejected.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="mt-1.5 min-h-8 text-xs font-bold text-accent hover:underline">
          اعرض الباقي (<span className="nums">{rejected.length - shown.length}</span>)
        </button>
      )}
    </>
  );
}

/** أبواب الحركة — هي نفسها المعروضة في «حلّ المعلّقات» بصفحة البنك. */
const KINDS: { value: string; label: string }[] = [
  { value: "SUPPLIER", label: "سداد مورّد" },
  { value: "SALARY", label: "راتب أو أجر" },
  { value: "RENT", label: "إيجار" },
  { value: "UTILITY", label: "كهرباء · مياه · اتصالات" },
  { value: "GOVERNMENT", label: "حكومي · تأمينات · ضريبة" },
  { value: "ZAKAT", label: "زكاة أو صدقة" },
  { value: "PERSONAL", label: "تحويل شخصي" },
  { value: "INTERNAL", label: "تحويل داخلي" },
  { value: "BANK_FEE", label: "رسوم بنكية" },
  { value: "OTHER", label: "أخرى" },
];

/** ما يُعلَن به أنّ الحركة ليست سداد فاتورة — مطابقٌ لما يقبله الخادم. */
const NOT_PAYMENT: { value: string; label: string }[] = [
  /*
    الدفعة المقدَّمة كانت تُحال إلى «صفحة البنك» — وزرُّها هناك لا يظهر
    أبداً. فصارت هنا حيث عُرف المورّد، وتُقيَّد دفعةً حالُها «مقدَّمة».
  */
  { value: "ADVANCE", label: "دفعة مقدَّمة لمورّد" },
  { value: "INTERNAL", label: "تحويل داخلي" },
  { value: "PERSONAL", label: "تحويل شخصي" },
  { value: "BANK_FEE", label: "رسم بنكيّ" },
];

/**
 * بصمةُ تكرارٍ ظاهر.
 *
 * في البيانات أزواجٌ من الحركة الواحدة: إحداهما تحمل وصف البنك الخام
 * والأخرى اسم المورّد وحده — أثرُ تلوّثٍ قديم في `beneficiary_raw`.
 * فتُسأل العين عن المال نفسه مرّتين بلا ما يدلّ على أنّهما واحد. ولا
 * تُدمجان هنا — الدمج قرارٌ ماليّ مكانه الخادم — وإنّما يُعلَن التشابه.
 */
function twinKey(i: ReviewItem): string {
  return `${i.supplierName ?? "—"}|${i.amountMinor}|${i.valueDate}`;
}

export function ReviewWorkspace({ items, canApprove, canEdit, suppliers = [] }: ReviewWorkspaceProps) {
  const router = useRouter();
  const groups = useMemo(() => groupForReview(items), [items]);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    rejected?: { transactionId: string; reason: string }[];
  } | null>(null);

  /** ما فُرغ منه في هذه الجلسة — يختفي فوراً ولا ينتظر تحديث الصفحة. */
  const [done, setDone] = useState<Map<string, string>>(new Map());
  /** البند المفتوح عليه محرِّرٌ، وأيّ محرِّر. */
  const [openOn, setOpenOn] = useState<{ id: string; mode: RowMode } | null>(null);
  /* انشغالٌ لكلّ صفّ — نقرتان على صفّين لا تتداخل رسالتاهما */
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());
  const [rowError, setRowError] = useState<Map<string, string>>(new Map());

  const busyOn = (id: string, on: boolean) =>
    setRowBusy((s) => {
      const next = new Set(s);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  const errorOn = (id: string, message: string | null) =>
    setRowError((m) => {
      const next = new Map(m);
      if (message) next.set(id, message); else next.delete(id);
      return next;
    });

  const confirmable = useMemo(
    () => bulkConfirmable(items).filter((id) => !done.has(id)),
    [items, done],
  );

  /** كم بندٍ في «يُؤكَّد» لا يقبل التأكيد الجماعيّ — وهو ما كان يُترك بلا تفسير. */
  const confirmBucket = groups.find((g) => g.bucket === "CONFIRM");
  const alreadyAuto = (confirmBucket?.items.length ?? 0) - bulkConfirmable(items).length;

  const twins = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of items) seen.set(twinKey(i), (seen.get(twinKey(i)) ?? 0) + 1);
    return seen;
  }, [items]);

  async function post(url: string, body: unknown, id: string, doneLabel: string, undoable = false) {
    if (rowBusy.has(id)) return;
    busyOn(id, true);
    errorOn(id, null);

    /*
      الردّ يُقرأ نصّاً قبل JSON، و«تعذّر الاتصال» حين لا يصل الطلب
      وحده — والقاعدتان في `http-client` لا منسوختان هنا.
    */
    const r = await postJson<{
      message?: string;
      confirmed?: number;
      outcomes?: { transactionId: string; ok: boolean; reason?: string }[];
    }>(url, body);

    if (!r.ok) {
      errorOn(id, r.error);
      busyOn(id, false);
      return;
    }
    const data = r.data;

    /*
      ‏«٢٠٠» تقول إنّ الطلب فُهم، لا إنّ شيئاً كُتب.
      والمسار الجماعيّ يردّ `ok: true` ومعه `confirmed: 0` حين يرفض كلّ
      ما أُرسل — لأنّ الحركة مطابَقةٌ أصلاً أو ليست اقتراحاً. وكان هذا
      يُقرأ نجاحاً، فيُرفَع البند من الشاشة ولم يُكتب شيء؛ فإذا حُدِّثت
      الصفحة عاد كأنّ الضغطة لم تقع. **والصمتُ عن الرفض أسوأ من الرفض.**
    */
    const rejected = (data.outcomes ?? []).filter((o) => !o.ok);
    if (data.confirmed === 0 && rejected.length > 0) {
      errorOn(id, rejected[0]?.reason ?? "لم يُكتب شيء — راجع حال الحركة.");
      busyOn(id, false);
      return;
    }

    setDone((d) => new Map(d).set(id, data.message ?? doneLabel));
    setOpenOn(null);
    busyOn(id, false);
    /*
      الإشعارُ بعد ردّ الخادم لا قبله. و«تراجع» يمرّ بمسار الردّ نفسه في
      صفحة البنك (`match-undo`): تُفكّ الدفعة وتُعلَن مردودةً ولا تُحذف،
      أو يُردّ إعلانُ «ليست سداداً» — فتعود الحركة إلى الطابور.
    */
    toast({
      tone: "ok",
      title: data.message ?? doneLabel,
      undo: undoable
        ? {
            run: async () => {
              const u = await postJson<{ message?: string }>("/api/match-undo", {
                transactionId: id,
                reason: "تراجعٌ من إشعار «يحتاج قرارك»",
              });
              if (!u.ok) return false;
              setDone((d) => {
                const next = new Map(d);
                next.delete(id);
                return next;
              });
              router.refresh();
              return true;
            },
          }
        : undefined,
    });
    router.refresh();
  }

  /*
    التأكيد الفرديّ يمرّ بالمسار الجماعيّ نفسه بمعرّفٍ واحد — كي يُعاد
    الحساب في الخادم على الفواتير كما هي الآن. ولو أُرسلت الفواتير من
    المتصفّح لصدَّق الخادمُ اقتراحاً حُسب لحظة الاستيراد وقد سُدّدت فاتورته.
  */
  const confirmOne = (id: string) =>
    post("/api/match-confirm-bulk", { transactionIds: [id] }, id, "أُكِّدت", true);

  /*
    فاتورةٌ بعينها من قائمةٍ حسبها الخادم — تُرسَل معرّفاتُها وحدها، والخادم
    يتحقّق أنّها ما زالت مرشّحةً ويحسب التخصيص.
  */
  const pickOne = (id: string, invoiceIds: string[]) =>
    post("/api/match-confirm-bulk", { transactionIds: [id], candidateInvoiceIds: invoiceIds }, id, "قُيِّدت على الفاتورة المختارة", true);

  const rejectOne = (id: string, kind: string) =>
    post("/api/match-confirm", { transactionId: id, notAPayment: kind }, id, "حُفظت", true);

  /*
    السدادُ على حساب المورّد — والسياسة تُقال قبل الضغط لا بعده.

    وهو الفعلُ الذي كان ينقص هذه الشاشة: عشرون حوالةً عرّف أحمد
    جهاتِها بيده، فخرجت من الطابور بلا أن يُقيَّد ريالٌ منها.
  */
  const settleOne = (id: string) =>
    post("/api/match-confirm", { transactionId: id, settleSupplier: true }, id, "قُيِّدت على حسابه", true);

  const defineOne = (id: string, kind: string, displayName: string, supplierId: string | null) =>
    post("/api/counterparty", { transactionId: id, kind, displayName, supplierId }, id, "عُرِّفت");

  async function confirmAll() {
    setBusy(true);
    setResult(null);
    try {
      /*
        تُرسَل المعرّفات وحدها — لا فواتير ولا مبالغ ولا مورّد.
        الخادم يُعيد الحساب على الفواتير كما هي الآن، لأنّ الاقتراح
        حُسب لحظةَ الاستيراد وقد تكون فاتورته سُدّدت بعده.
      */
      const r = await postJson<{
        message?: string;
        confirmed?: number;
        outcomes?: { transactionId: string; ok: boolean; reason?: string }[];
      }>("/api/match-confirm-bulk", { transactionIds: confirmable.slice(0, 50) });

      if (!r.ok) {
        setResult({ ok: false, message: r.error });
        return;
      }

      const rejected = (r.data.outcomes ?? [])
        .filter((o) => !o.ok)
        .map((o) => ({ transactionId: o.transactionId, reason: o.reason ?? "رُدّ" }));

      /* لم يُكتب شيء — فالنتيجة ليست نجاحاً وإن كان الرمز ٢٠٠ */
      /* خمسون في المرّة: ما لم يُرسَل يُقال بعدده ولا يُترَك للعدّ */
      const left = Math.max(0, confirmable.length - 50);
      setResult({
        ok: (r.data.confirmed ?? 0) > 0,
        message: `${r.data.message ?? ""}${left > 0 ? ` · بقي ${left} لم يُرسَل — اضغط ثانيةً لتكمل.` : ""}`,
        rejected,
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="لا شيء ينتظرك"
        hint="كل حركة في الكشف لها قرارٌ مسجَّل — إمّا مطابَقة وإمّا معلَنٌ أنّها ليست سداداً."
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* الخلاصة تُقرأ في ثانية: «يُؤكَّد ٣٠١ · يُراجَع ١٧ · يُحسَم ٩». */}
      {/*
        ثلاثٌ في صفٍّ واحد على كلّ مقاس. كانت على الجوّال بطاقاتٍ متراصّة
        تأكل أربعمئة بكسلٍ قبل أوّل بند — ومنها بطاقةٌ خضراء لمجموعةٍ فارغة.
        فالشرحُ يظهر حيث يتّسع له المكان، والفارغةُ تهدأ.
      */}
      <div className="grid grid-cols-3 divide-x divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {groups.map((g) => {
          const left = g.items.filter((i) => !done.has(i.transactionId)).length;
          return (
            <div key={g.bucket} className={`px-3 py-3 sm:px-4 ${left === 0 ? "text-muted" : ""}`}>
              <p className="flex items-center gap-1.5 text-xs font-bold">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${left === 0 ? "bg-line" : BUCKET_DOT[g.bucket]}`} />
                {BUCKET_LABEL[g.bucket]}
              </p>
              <p className="nums mt-1.5 text-2xl font-bold leading-none">{left}</p>
              <p className="mt-1.5 hidden text-[11px] leading-relaxed text-muted sm:block">{BUCKET_HINT[g.bucket]}</p>
              {g.amountMinor > 0 && (
                /* المبلغ كان بأضعف رمادٍ في البطاقة — وهو المال نفسه */
                <p className="mt-1 text-xs font-bold text-ink-soft">
                  <Money minor={g.amountMinor} />
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* ── يُؤكَّد: تأكيدٌ جماعيّ ── */}
      {confirmable.length > 0 && canApprove && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold">
                {countNoun(confirmable.length, SUGGESTION)} ينتظر تأكيدك
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                يُعاد حسابها في الخادم قبل الكتابة — على الفواتير كما هي الآن، لا كما
                كانت لحظة الاستيراد. وما تغيّر حاله يُعاد إليك بسببه ولا يُؤكَّد.
                {confirmable.length > 50 && " ويُؤكَّد خمسون في المرّة."}
              </p>
              {/*
                كان العدّان يختلفان بلا تفسير: البطاقة تقول «يُقَرّ ٨» والزرّ
                «أقِرّ ٣». والفرق أنّ خمساً طُوبقت تلقائياً ولا تنتظر أحداً.
              */}
              {alreadyAuto > 0 && (
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  ومعها {countNoun(alreadyAuto, TRANSACTION)} طُوبقت تلقائياً ولا تنتظر
                  تأكيدك — معروضةٌ أدناه للاطّلاع، وبابُ التراجع عنها في صفحة البنك.
                </p>
              )}
            </div>
            <button
              aria-busy={busy}
              type="button"
              className={buttonClass("primary")}
              disabled={busy}
              onClick={confirmAll}
            >
              {recordBatch(Math.min(50, confirmable.length))}
            </button>
          </div>

          {result && (
            <div
              className={`mt-3 rounded-xl border px-3 py-2.5 ${
                /* كان الفشل يطلب رمزاً لا وجود له فيخرج بلا لون — أهدأ من النجاح */
                result.ok ? "border-ok/40 bg-ok-bg" : "border-danger/40 bg-danger-bg"
              }`}
            >
              <p className={`text-xs font-bold ${result.ok ? "" : "text-danger"}`}>
                {result.message}
              </p>
              {result.rejected && result.rejected.length > 0 && (
                <RejectedList rejected={result.rejected} items={items} />
              )}
            </div>
          )}
        </Card>
      )}

      {/* ── القوائم ── */}
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <Bucket
            key={g.bucket}
            bucket={g.bucket}
            items={g.items}
            twins={twins}
            done={done}
            openOn={openOn}
            setOpenOn={setOpenOn}
            rowBusy={rowBusy}
            rowError={rowError}
            suppliers={suppliers}
            canApprove={canApprove}
            canEdit={canEdit}
            onConfirm={confirmOne}
            onPick={pickOne}
            onSettle={settleOne}
            onReject={rejectOne}
            onDefine={defineOne}
          />
        ))}
    </div>
  );
}

/**
 * قائمةُ بابٍ واحد.
 *
 * وكان المعروض مقصوراً على أربعين بلا وسيلةٍ لبلوغ ما بعدها — فمن ثلاثمئةٍ
 * وستٍّ وثلاثين يظهر أربعون، والباقي يُذكَر عدداً ولا يُبلَغ من هذه الشاشة
 * أصلاً. فصار يُوسَّع أربعين أربعين.
 */
function Bucket({
  bucket, items, twins, done, openOn, setOpenOn, rowBusy, rowError, suppliers,
  canApprove, canEdit, onConfirm, onPick, onSettle, onReject, onDefine,
}: {
  bucket: ReviewBucket;
  items: ReviewItem[];
  twins: Map<string, number>;
  done: Map<string, string>;
  openOn: { id: string; mode: RowMode } | null;
  setOpenOn: (v: { id: string; mode: RowMode } | null) => void;
  rowBusy: Set<string>;
  rowError: Map<string, string>;
  suppliers: readonly { id: string; nameAr: string }[];
  canApprove: boolean;
  canEdit: boolean;
  onConfirm: (id: string) => void;
  onPick: (id: string, invoiceIds: string[]) => void;
  onSettle: (id: string) => void;
  onReject: (id: string, kind: string) => void;
  onDefine: (id: string, kind: string, name: string, supplierId: string | null) => void;
}) {
  const [shown, setShown] = useState(40);
  const visible = items.slice(0, shown);
  const rest = items.length - visible.length;
  const left = items.filter((i) => !done.has(i.transactionId)).length;

  return (
    <section>
      <h2 className="mb-2 text-sm font-bold">
        {BUCKET_LABEL[bucket]} <span className="nums text-muted">({left})</span>
      </h2>
      <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
        {visible.map((i) => (
          <Row
            key={i.transactionId}
            item={i}
            bucket={bucket}
            twin={(twins.get(twinKey(i)) ?? 1) > 1}
            doneMessage={done.get(i.transactionId)}
            open={openOn?.id === i.transactionId ? openOn.mode : null}
            setOpen={(mode) => setOpenOn(mode ? { id: i.transactionId, mode } : null)}
            busy={rowBusy.has(i.transactionId)}
            error={rowError.get(i.transactionId) ?? null}
            suppliers={suppliers}
            canApprove={canApprove}
            canEdit={canEdit}
            onConfirm={onConfirm}
            onPick={onPick}
            onSettle={onSettle}
            onReject={onReject}
            onDefine={onDefine}
          />
        ))}
      </ul>
      {rest > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setShown((s) => s + 40)}>
            أظهر {Math.min(40, rest)} أخرى
          </button>
          <span className="text-xs text-muted">
            بقيت <span className="nums">{rest}</span> — والترتيب بالمبلغ، لأنّ خطأ الأكبر أغلى.
          </span>
        </div>
      )}
    </section>
  );
}

/** بندٌ واحد: ما هو، ولماذا هو هنا، وما الذي تفعله به. */
function Row({
  item: i, bucket, twin, doneMessage, open, setOpen, busy, error, suppliers,
  canApprove, canEdit, onConfirm, onPick, onSettle, onReject, onDefine,
}: {
  item: ReviewItem;
  bucket: ReviewBucket;
  twin: boolean;
  doneMessage?: string;
  open: RowMode | null;
  setOpen: (mode: RowMode | null) => void;
  busy: boolean;
  error: string | null;
  suppliers: readonly { id: string; nameAr: string }[];
  canApprove: boolean;
  canEdit: boolean;
  onConfirm: (id: string) => void;
  onPick: (id: string, invoiceIds: string[]) => void;
  onSettle: (id: string) => void;
  onReject: (id: string, kind: string) => void;
  onDefine: (id: string, kind: string, name: string, supplierId: string | null) => void;
}) {
  const [kind, setKind] = useState("");
  const [supplierId, setSupplierId] = useState(i.supplierId ?? "");

  if (doneMessage) {
    return (
      <li className="flex flex-wrap items-baseline justify-between gap-2 bg-ok-bg px-4 py-3">
        <span className="text-sm font-medium">{i.supplierName ?? "جهة غير معروفة"}</span>
        <span className="text-xs font-bold text-ok">{doneMessage}</span>
      </li>
    );
  }

  const canAct = bucket === "RESOLVE" ? canEdit : canApprove;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-medium">{i.supplierName ?? "جهة غير معروفة"}</span>
          {twin && <Badge tone="warn">نسختان من الحركة نفسها</Badge>}
        </span>
        <span className="nums text-sm font-bold">
          <Money minor={i.amountMinor} />
        </span>
      </div>

      {/* الوصف عربيّ أو لاتينيّ بحسب البنك — `auto` لا `ltr`، والتاريخ معزول */}
      <p className="mt-0.5 text-xs text-muted" dir="auto">
        <bdi>{formatDay(i.valueDate)}</bdi> · {i.description.slice(0, 80)}
      </p>

      {i.reasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {i.reasons.slice(0, 3).map((why, n) => (
            <li key={n} className="text-xs leading-relaxed text-ink-soft">
              — {why}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {i.score !== null && (
          /* وصفُ الترجيح لا نسبة — «٩٨٪» تُقرأ يقيناً وليست كذلك */
          <Badge tone={i.score >= 85 ? "ok" : "warn"}>{strength(i.score)}</Badge>
        )}

        {/* ── الأفعال ── */}
        {canAct && bucket !== "RESOLVE" && (
          <>
            {/*
              الفعلُ يتبع ما تحتاجه الحركة فعلاً.

              ما له اقتراحُ فاتورةٍ يُؤكَّد؛ وما عُرف مورّدُه ولا اقتراحَ
              له يُقيَّد على حسابه. وكان الزرّ واحداً في الحالين، فيردّ
              الخادمُ الثانيةَ بحقّ: «ليست اقتراحاً». **وزرٌّ لا يعمل
              أسوأ من غيابه** — يُقرأ عملاً بقي وهو عملٌ لا سبيل إليه.
            */}
            {settleable(i) ? (
              <button
                aria-busy={busy}
                type="button"
                className={buttonClass("primary", "sm")}
                disabled={busy}
                onClick={() => onSettle(i.transactionId)}
                title="تُسجَّل سداداً لهذا المورّد وتُخصم من أقدم فواتيره، وما بقي يبقى بلا فاتورة"
              >
                {ACT.settleOnAccount}
              </button>
            ) : (
            <button
              aria-busy={busy}
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={busy}
              onClick={() => onConfirm(i.transactionId)}
            >
              {ACT.recordAgainstInvoice}
            </button>
            )}
            {/*
              «مرشّحان متقاربان» كانت تُعرَض بسببها وحده. فتُعرَض الفواتيرُ
              المرشّحة جنباً إلى جنب كما يحسبها الخادم الآن، ويُختار بضغطة.
            */}
            {i.direction === "DEBIT" && i.supplierId && (
              <button
                type="button"
                className={buttonClass("secondary", "sm")}
                disabled={busy}
                onClick={() => setOpen(open === "pick" ? null : "pick")}
                aria-expanded={open === "pick"}
              >
                اختر الفاتورة
              </button>
            )}
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              disabled={busy}
              onClick={() => setOpen(open === "reject" ? null : "reject")}
              aria-expanded={open === "reject"}
            >
              ليست سداداً
            </button>
          </>
        )}

        {canAct && bucket === "RESOLVE" && (
          <button
            type="button"
            className={buttonClass("primary", "sm")}
            disabled={busy}
            onClick={() => setOpen(open === "define" ? null : "define")}
            aria-expanded={open === "define"}
          >
            عرِّف هذه الجهة
          </button>
        )}

        <Link href={txHref(i.transactionId)} className={buttonClass("quiet", "sm")}>
          افتحها في البنك ←
        </Link>
      </div>

      {/* السياسة تُقال قبل الضغط — والمخفيّة تُنتج ثقةً بلا فهم */}
      {canAct && settleable(i) && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          لا رقمَ فاتورةٍ في الحوالة — فتُوزَّع على فواتير {i.supplierName} المفتوحة
          بالأقدم أوّلاً، وما بقي يبقى على حسابه غير مخصَّص.
        </p>
      )}

      {open === "pick" && (
        <CandidatePicker
          transactionId={i.transactionId}
          busy={busy}
          onPick={(invoiceIds) => onPick(i.transactionId, invoiceIds)}
        />
      )}

      {/* ── ليست سداداً: السبب ── */}
      {open === "reject" && (
        <div className="mt-2 rounded-xl border border-line bg-sunken px-3 py-2.5">
          <p className="text-xs font-bold">ما هذه الحركة إذن؟</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {NOT_PAYMENT.map((k) => (
              <button
                key={k.value}
                type="button"
                className={buttonClass("secondary", "sm")}
                disabled={busy}
                onClick={() => onReject(i.transactionId, k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            «دفعة مقدَّمة» تُقيَّد لمورّدها مالاً خرج قبل فاتورته، فيُخصَّص عليها حين تصل —
            ولا تُتجاهَل كالتحويل الداخليّ.
          </p>
        </div>
      )}

      {/* ── تعريف الجهة ── */}
      {open === "define" && (
        <div className="mt-2 rounded-xl border border-line bg-sunken px-3 py-2.5">
          <p className="text-xs font-bold">ما بابُ هذه الحركة؟</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                aria-pressed={kind === k.value}
                className={buttonClass(kind === k.value ? "primary" : "secondary", "sm")}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === "SUPPLIER" && (
            <SupplierPicker
              text={[i.beneficiary, i.description].filter(Boolean).join(" ")}
              suppliers={suppliers}
              value={supplierId}
              onChange={setSupplierId}
              disabled={busy}
              canCreate={canEdit}
              createName={i.beneficiary ?? ""}
            />
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              aria-busy={busy}
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={busy || !kind || (kind === "SUPPLIER" && !supplierId)}
              onClick={() =>
                onDefine(
                  i.transactionId,
                  kind,
                  /* الاسم من نصّ البنك، لا من الوصف الخام ولا من العمود الملوَّث */
                  (i.beneficiary ?? "").slice(0, 60)
                    || (kind === "SUPPLIER" ? suppliers.find((s) => s.id === supplierId)?.nameAr ?? "" : ""),
                  kind === "SUPPLIER" ? supplierId : null,
                )
              }
            >
              {ACT.saveIdentity}
            </button>
            <span className="text-xs leading-relaxed text-muted">
              ما تؤكّده يصير ذاكرة: يُطبَّق الآن على ما اخترتَه، ويُعرَف به ما يشبهه في الكشوف القادمة بلا سؤال.
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

const OUTCOME_NOTE: Record<string, string> = {
  EXACT_INVOICE: "فاتورةٌ بمبلغها",
  MULTI_INVOICE: "عدّة فواتير مجموعُها الدفعة",
  PARTIAL_PAYMENT: "سدادٌ جزئيّ — يبقى عليها",
  OVERPAYMENT: "تزيد على المتبقّي — والزائد يبقى على حساب المورّد",
};

/**
 * المرشّحون جنباً إلى جنب — من الخادم لحظةَ الفتح، لا ممّا حُفظ عند الاستيراد.
 * والاختيارُ يُرسِل معرّفات الفواتير وحدها.
 */
function CandidatePicker({
  transactionId, busy, onPick,
}: {
  transactionId: string;
  busy: boolean;
  onPick: (invoiceIds: string[]) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; candidates: CandidateView[] }
  >({ status: "loading" });

  useEffect(() => {
    let live = true;
    void postJson<{ candidates?: CandidateView[] }>("/api/match-candidates", { transactionId }).then((r) => {
      if (!live) return;
      setState(r.ok
        ? { status: "ready", candidates: r.data.candidates ?? [] }
        : { status: "error", message: r.error });
    });
    return () => { live = false; };
  }, [transactionId]);

  return (
    <div className="mt-2 rounded-xl border border-line bg-sunken px-3 py-2.5" aria-live="polite">
      <p className="text-xs font-bold">أيّ فاتورةٍ تسدّدها هذه الحوالة؟</p>
      {state.status === "loading" && <p className="mt-2 text-xs text-muted">يُحسَب المرشّحون على الفواتير كما هي الآن…</p>}
      {state.status === "error" && (
        <p role="alert" className="mt-2 text-xs font-bold text-danger">{state.message}</p>
      )}
      {state.status === "ready" && state.candidates.length === 0 && (
        <p className="mt-2 text-xs leading-relaxed text-muted">
          لا فاتورةَ مفتوحة لهذا المورّد تقارب مبلغَ الحوالة. قيّدها على حسابه، أو ارفع فاتورتَها فتُقترَح هنا.
        </p>
      )}
      {state.status === "ready" && state.candidates.length > 0 && (
        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {state.candidates.map((c) => (
            <li key={c.key} className="flex flex-col rounded-lg border border-line bg-raised p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={c.score >= 85 ? "ok" : "warn"}>{strength(c.score)}</Badge>
                {c.recommended && <Badge tone="accent">ترجيحُ النظام</Badge>}
              </div>
              <ul className="mt-2 space-y-1">
                {c.invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                    <Link href={`/purchases/invoices/${inv.id}`} className="font-bold underline-offset-2 hover:underline">
                      <bdi>{inv.number ?? "بلا رقم"}</bdi>
                    </Link>
                    <span className="text-muted">{inv.date ? <bdi>{formatDay(inv.date.slice(0, 10))}</bdi> : "تاريخٌ غير معروف"}</span>
                    <span className="nums font-bold">
                      {inv.outstandingMinor === null ? "غير معروف" : <Money minor={inv.outstandingMinor} />}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
                {OUTCOME_NOTE[c.outcome] ?? "مرشّح"} · يُخصَّص <Money minor={c.allocatedMinor} />
              </p>
              <dl className="mt-2 grid grid-cols-4 gap-1 text-center">
                <Part label="المورّد" value={c.parts.supplier} />
                <Part label="المبلغ" value={c.parts.amount} />
                <Part label="التاريخ" value={c.parts.date} />
                <Part label="المرجع" value={c.parts.reference} />
              </dl>
              <ul className="mt-2 flex-1 space-y-0.5">
                {c.evidence.slice(1, 5).map((e, n) => (
                  <li key={n} className="text-[11px] leading-relaxed text-muted" dir="auto">— {e}</li>
                ))}
              </ul>
              <button
                type="button"
                aria-busy={busy}
                disabled={busy}
                className={`mt-2.5 ${buttonClass(c.recommended ? "primary" : "secondary", "sm")}`}
                onClick={() => onPick(c.invoiceIds)}
              >
                {c.invoices.length > 1 ? "قيّدها على هذه الفواتير" : "قيّدها على هذه الفاتورة"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        الخادم يتحقّق من اختيارك على الفواتير كما هي لحظةَ الكتابة ويحسب التخصيص — وما زاد يبقى على حساب المورّد غير مخصَّص.
      </p>
    </div>
  );
}

/** بُعدٌ من أبعاد الترجيح — من مئة، و«—» لما لا يُقاس. */
function Part({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md bg-sunken px-1 py-1">
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className="nums text-[11px] font-bold">{value === null ? "—" : value}</dd>
    </div>
  );
}
