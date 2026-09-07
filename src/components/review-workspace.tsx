"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Money } from "./money";
import { Badge, buttonClass, Card, EmptyState } from "./ui";
import { countNoun, SUGGESTION, TRANSACTION } from "@/lib/arabic";
import {
  BUCKET_HINT, BUCKET_LABEL, bulkConfirmable, groupForReview,
  type ReviewBucket, type ReviewItem,
} from "@/lib/bank/review-queue";

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

export interface ReviewWorkspaceProps {
  items: ReviewItem[];
  /** هل يملك المستخدم صلاحية الإقرار؟ */
  canApprove: boolean;
  /** هل يملك صلاحية تعريف الجهات وتصنيفها؟ */
  canEdit: boolean;
}

const BUCKET_TONE: Record<ReviewBucket, string> = {
  CONFIRM: "border-ok/40 bg-ok-bg",
  REVIEW: "border-warn/40 bg-warn-bg",
  RESOLVE: "border-line bg-raised",
};

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

export function ReviewWorkspace({ items, canApprove, canEdit }: ReviewWorkspaceProps) {
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
  const [openOn, setOpenOn] = useState<{ id: string; mode: "reject" | "define" } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

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

  async function post(url: string, body: unknown, id: string, doneLabel: string) {
    setRowBusy(id);
    setRowError(null);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* لم يصل الطلب أصلاً — وهذا وحده عطبُ شبكة */
      setRowError({ id, message: "تعذّر الاتصال بالخادم. تحقّق من الشبكة ثمّ أعد المحاولة." });
      setRowBusy(null);
      return;
    }

    /*
      الخادم ردّ — فالعطب عنده لا في الشبكة.
      وكان كلا الحالين يُعرَض «تعذّر الاتصال»، فيُرسَل صاحب العمل يفحص
      شبكته وهي سليمة. ولو انهار الطلب قبل أن يُنشئ جسماً بصيغة JSON
      لجاء الردّ صفحةَ خطأ فيفشل `json()` — وهو أيضاً عطبُ خادم لا شبكة.
    */
    let data: {
      error?: string;
      message?: string;
      confirmed?: number;
      outcomes?: { transactionId: string; ok: boolean; reason?: string }[];
    } = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      setRowError({
        id,
        message: data.error ?? `تعذّر الحفظ — ردّ الخادم بالرمز ${res.status}. أعد المحاولة، فإن تكرّر فأبلِغ مالك الحساب.`,
      });
      setRowBusy(null);
      return;
    }

    /*
      ‏«٢٠٠» تقول إنّ الطلب فُهم، لا إنّ شيئاً كُتب.
      والمسار الجماعيّ يردّ `ok: true` ومعه `confirmed: 0` حين يرفض كلّ
      ما أُرسل — لأنّ الحركة مطابَقةٌ أصلاً أو ليست اقتراحاً. وكان هذا
      يُقرأ نجاحاً، فيُرفَع البند من الشاشة ولم يُكتب شيء؛ فإذا حُدِّثت
      الصفحة عاد كأنّ الضغطة لم تقع. **والصمتُ عن الرفض أسوأ من الرفض.**
    */
    const rejected = (data.outcomes ?? []).filter((o) => !o.ok);
    if (data.confirmed === 0 && rejected.length > 0) {
      setRowError({ id, message: rejected[0]?.reason ?? "لم يُكتب شيء — راجع حال الحركة." });
      setRowBusy(null);
      return;
    }

    setDone((d) => new Map(d).set(id, data.message ?? doneLabel));
    setOpenOn(null);
    setRowBusy(null);
    router.refresh();
  }

  /*
    التأكيد الفرديّ يمرّ بالمسار الجماعيّ نفسه بمعرّفٍ واحد — كي يُعاد
    الحساب في الخادم على الفواتير كما هي الآن. ولو أُرسلت الفواتير من
    المتصفّح لصدَّق الخادمُ اقتراحاً حُسب لحظة الاستيراد وقد سُدّدت فاتورته.
  */
  const confirmOne = (id: string) =>
    post("/api/match-confirm-bulk", { transactionIds: [id] }, id, "أُكِّدت");

  const rejectOne = (id: string, kind: string) =>
    post("/api/match-confirm", { transactionId: id, notAPayment: kind }, id, "حُفظت");

  const defineOne = (id: string, kind: string, displayName: string) =>
    post("/api/counterparty", { transactionId: id, kind, displayName }, id, "عُرِّفت");

  async function confirmAll() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/match-confirm-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
          تُرسَل المعرّفات وحدها — لا فواتير ولا مبالغ ولا مورّد.
          الخادم يُعيد الحساب على الفواتير كما هي الآن، لأنّ الاقتراح
          حُسب لحظةَ الاستيراد وقد تكون فاتورته سُدّدت بعده.
        */
        body: JSON.stringify({ transactionIds: confirmable.slice(0, 50) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "تعذّر التأكيد" });
        return;
      }

      const rejected = (data.outcomes ?? [])
        .filter((o: { ok: boolean }) => !o.ok)
        .map((o: { transactionId: string; reason: string }) => ({
          transactionId: o.transactionId,
          reason: o.reason,
        }));

      /* لم يُكتب شيء — فالنتيجة ليست نجاحاً وإن كان الرمز ٢٠٠ */
      setResult({ ok: data.confirmed > 0, message: data.message, rejected });
      router.refresh();
    } catch {
      setResult({ ok: false, message: "تعذّر الاتصال. تحقّق من الشبكة ثمّ أعد المحاولة." });
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
    <div className="space-y-6">
      {/* الخلاصة تُقرأ في ثانية: «يُؤكَّد ٣٠١ · يُراجَع ١٧ · يُحسَم ٩». */}
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map((g) => {
          const left = g.items.filter((i) => !done.has(i.transactionId)).length;
          return (
            <div
              key={g.bucket}
              className={`rounded-2xl border px-4 py-3 shadow-raised ${BUCKET_TONE[g.bucket]}`}
            >
              <p className="text-xs font-bold">{BUCKET_LABEL[g.bucket]}</p>
              <p className="nums mt-1 font-display text-3xl font-bold leading-none">{left}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-soft">{BUCKET_HINT[g.bucket]}</p>
              {g.amountMinor > 0 && (
                /* المبلغ كان بأضعف رمادٍ في البطاقة — وهو المال نفسه */
                <p className="mt-1 text-xs text-ink-soft">
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
              type="button"
              className={buttonClass("primary")}
              disabled={busy}
              onClick={confirmAll}
            >
              {busy ? "يُعاد الحساب…" : `أكّد ${Math.min(50, confirmable.length)}`}
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
                <ul className="mt-1.5 space-y-0.5">
                  {result.rejected.slice(0, 6).map((r) => (
                    <li key={r.transactionId} className="text-xs leading-relaxed text-ink-soft">
                      {r.reason}
                    </li>
                  ))}
                </ul>
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
            canApprove={canApprove}
            canEdit={canEdit}
            onConfirm={confirmOne}
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
  bucket, items, twins, done, openOn, setOpenOn, rowBusy, rowError,
  canApprove, canEdit, onConfirm, onReject, onDefine,
}: {
  bucket: ReviewBucket;
  items: ReviewItem[];
  twins: Map<string, number>;
  done: Map<string, string>;
  openOn: { id: string; mode: "reject" | "define" } | null;
  setOpenOn: (v: { id: string; mode: "reject" | "define" } | null) => void;
  rowBusy: string | null;
  rowError: { id: string; message: string } | null;
  canApprove: boolean;
  canEdit: boolean;
  onConfirm: (id: string) => void;
  onReject: (id: string, kind: string) => void;
  onDefine: (id: string, kind: string, name: string) => void;
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
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-raised shadow-raised">
        {visible.map((i) => (
          <Row
            key={i.transactionId}
            item={i}
            bucket={bucket}
            twin={(twins.get(twinKey(i)) ?? 1) > 1}
            doneMessage={done.get(i.transactionId)}
            open={openOn?.id === i.transactionId ? openOn.mode : null}
            setOpen={(mode) => setOpenOn(mode ? { id: i.transactionId, mode } : null)}
            busy={rowBusy === i.transactionId}
            error={rowError?.id === i.transactionId ? rowError.message : null}
            canApprove={canApprove}
            canEdit={canEdit}
            onConfirm={onConfirm}
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
  item: i, bucket, twin, doneMessage, open, setOpen, busy, error,
  canApprove, canEdit, onConfirm, onReject, onDefine,
}: {
  item: ReviewItem;
  bucket: ReviewBucket;
  twin: boolean;
  doneMessage?: string;
  open: "reject" | "define" | null;
  setOpen: (mode: "reject" | "define" | null) => void;
  busy: boolean;
  error: string | null;
  canApprove: boolean;
  canEdit: boolean;
  onConfirm: (id: string) => void;
  onReject: (id: string, kind: string) => void;
  onDefine: (id: string, kind: string, name: string) => void;
}) {
  const [kind, setKind] = useState("");

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

      <p className="nums mt-0.5 text-xs text-muted" dir="ltr">
        {i.valueDate} · {i.description.slice(0, 80)}
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
          <Badge tone={i.score >= 85 ? "ok" : "warn"}>
            <span className="nums">{i.score}٪</span>
          </Badge>
        )}

        {/* ── الأفعال ── */}
        {canAct && bucket !== "RESOLVE" && (
          <>
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={busy}
              onClick={() => onConfirm(i.transactionId)}
            >
              {busy ? "يُعاد الحساب…" : "أكّد"}
            </button>
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

        <Link href="/bank" className={buttonClass("quiet", "sm")}>
          افتحها في البنك ←
        </Link>
      </div>

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
            وما دُفع للمورّد قبل وصول فاتورته ليس من هذه — يُقيَّد دفعةً مقدَّمة من صفحة البنك،
            كي يبقى له أثرٌ يُخصَّص على الفاتورة حين تصل.
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
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={busy || !kind}
              onClick={() => onDefine(i.transactionId, kind, i.description.slice(0, 60))}
            >
              {busy ? "يُحفظ…" : "أكّد التعريف"}
            </button>
            <span className="text-xs leading-relaxed text-muted">
              ما تؤكّده يصير ذاكرةً تسري على أمثاله — في الكشوف السابقة الآن، وفي القادمة بلا سؤال.
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
