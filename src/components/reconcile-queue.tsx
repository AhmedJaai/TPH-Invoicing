"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "./money";
import { Badge, buttonClass, Card, EmptyState } from "./ui";
import { countNoun, TRANSACTION } from "@/lib/arabic";

/**
 * حلّ المعلّقات — **مجموعةً مجموعة** لا حركةً حركة.
 *
 * كانت الشاشة تسأل عن كل حركة على حدة. وفي كشفٍ فيه ستّون حركة، خمس
 * عشرة منها لمورّدٍ واحد، يعني ذلك خمسة عشر سؤالاً عن شيءٍ واحد —
 * فيُترَك الطابور ولا يُنجَز. والنظام الذي لا يُستعمَل لا يحمي شيئاً.
 *
 * فصار السؤال: **ما هذه السبع؟** ثمّ تُحسَم السبع بضغطة. وما يُجاب به
 * يُحفَظ هويّةً للجهة، فتُعرَف أخواتُها في الكشوف السابقة الآن، وفي
 * القادمة بلا سؤال.
 *
 * والتجميع يقع في الخادم لا هنا: هو الذي يشتقّ الهويّة، وهو الذي
 * يتحقّق منها ثانيةً قبل الكتابة. وهذه الشاشة تعرض ما جمعه.
 */

export type QueueReason =
  | "UNKNOWN_ENTITY"
  | "CLOSE_CANDIDATES"
  | "AMOUNT_MISMATCH"
  | "PARTIAL_PAYMENT"
  | "OVERPAYMENT"
  | "SUGGESTED"
  | "APPROXIMATE"
  | "KNOWN_SUPPLIER_NO_INVOICE";

export const REASON_LABEL: Record<QueueReason, string> = {
  UNKNOWN_ENTITY: "مستفيد غير معروف",
  CLOSE_CANDIDATES: "مرشّحان متقاربان",
  AMOUNT_MISMATCH: "المبلغ لا يوافق فاتورة",
  PARTIAL_PAYMENT: "سداد جزئي",
  OVERPAYMENT: "أكثر من المستحقّ",
  SUGGESTED: "اقتراح ينتظر إقرارك",
  APPROXIMATE: "حلٌّ تقريبيّ",
  KNOWN_SUPPLIER_NO_INVOICE: "المورّد معروف ولا فاتورة تقابله",
};

export interface CandidateOption {
  invoiceIds: string[];
  label: string;
  amountMinor: number;
  score: number;
  why: string[];
}

export interface QueueItem {
  id: string;
  date: string;
  amountMinor: number;
  direction: "DEBIT" | "CREDIT";
  description: string;
  beneficiaryRaw: string | null;
  reason: QueueReason;
  guessName: string | null;
  guessKind: string | null;
  why: string[];
  candidates?: CandidateOption[];
}

/**
 * مجموعةٌ من الحركات يجمعها دليلٌ واحد.
 *
 * و`identityLabel` ليس زينة: هو جواب «لماذا اجتمعت هذه؟» — رقمُ حسابٍ
 * واحد أم نمطُ وصفٍ واحد. ومن لا يعرف لماذا اجتمعت لا ينبغي أن يحسمها
 * دفعةً واحدة.
 */
export interface QueueGroup {
  key: string;
  /** نوع الدليل الجامع: «رقم الحساب» · «نمط الوصف» … */
  identityLabel: string;
  /** ما يُعرَض عنواناً: اسم المستفيد أو صدر النمط. */
  title: string;
  totalMinor: number;
  items: QueueItem[];
  /** ما رجّحه المحرّك للمجموعة، إن رجّح. */
  guessName: string | null;
  why: string[];
  /** المورّد إن اجتمعت المجموعة عليه — وبه يُتاح السداد على حسابه. */
  supplierId?: string | null;
  supplierName?: string | null;
  /** ما عليه من فواتير مفتوحة الآن. */
  outstandingMinor?: number;
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

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

export function ReconcileQueue({
  groups,
  suppliers,
}: {
  groups: readonly QueueGroup[];
  suppliers: readonly SupplierOption[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  const remaining = groups.filter((g) => !done.has(g.key));
  const group = remaining[0];

  const pendingCount = remaining.reduce((n, g) => n + g.items.length, 0);

  if (!group) {
    return (
      <EmptyState
        title="لا شيء معلّق."
        hint="كل حركة عُرف وجهها. وما يأتي بعدها يُصنَّف تلقائياً ما دام يشبه ما أكّدتَه."
      />
    );
  }

  function next() {
    setDone((d) => new Set(d).add(group!.key));
    setKind(null);
    setSupplierId("");
    setName("");
    setExpanded(false);
  }

  async function post(url: string, payload: unknown, onOk: () => void) {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setFailed(true);
        setMessage(data.error ?? "تعذّر الحفظ");
      } else {
        setMessage(data.message ?? "حُفظت");
        router.refresh();
        onOk();
      }
    } catch {
      setFailed(true);
      setMessage("تعذّر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  }

  const single = group.items.length === 1 ? group.items[0] : null;

  /** يقبل مرشّحاً بعينه — ولا يكون إلّا لحركةٍ مفردة. */
  const acceptCandidate = (option: CandidateOption) =>
    post("/api/match-confirm",
      { transactionId: single!.id, invoiceIds: option.invoiceIds }, next);

  const markNotAPayment = () =>
    post("/api/match-confirm", { transactionId: single!.id, notAPayment: "ADVANCE" }, next);

  /**
   * سدادٌ على حساب المورّد — لا على فاتورةٍ بعينها.
   *
   * وليست حالةً استثنائية: بعض المورّدين لا يعطون فاتورةً أصلاً، يعطون
   * كشف حسابٍ أو ورقةً باليد. فكان النظام يقف عند «المورّد معروف ولا
   * فاتورة تقابله» ولا يعطي فعلاً — خمسٌ وستّون حركة بمئةٍ وستّةٍ
   * وسبعين ألف ريال.
   */
  async function settleAccount() {
    setBusy(true);
    setFailed(false);
    try {
      /*
        المجموعة تُرسَل معاً — والخادم يقيّدها في معاملةٍ واحدة.

        وكانت تُرسَل حركةً حركة: خمسةَ عشر طلباً لمجموعةٍ واحدة، فإن
        نجح ثمانية وفشل التاسع بقيت نصفَ مقيَّدة ولا أحد يعرف أين وقفت.
      */
      const res = await fetch("/api/match-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactionId: group!.items[0].id,
          transactionIds: group!.items.map((i) => i.id),
          settleSupplier: true,
        }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) { setFailed(true); setMessage(data.error ?? "تعذّر السداد"); }
      else { setMessage(data.message ?? "سُدِّد"); router.refresh(); next(); }
    } catch {
      setFailed(true);
      setMessage("تعذّر الاتصال بالخادم");
    } finally {
      setBusy(false);
    }
  }

  /** يؤكّد المجموعة كلّها — والخادم يعيد التحقّق من أنّها مجموعة. */
  const confirm = () =>
    post("/api/counterparty", {
      transactionIds: group.items.map((i) => i.id),
      kind,
      supplierId: kind === "SUPPLIER" ? supplierId : null,
      displayName: name.trim() || group.items[0].beneficiaryRaw || undefined,
    }, next);

  const ready = kind !== null && (kind !== "SUPPLIER" || supplierId !== "");
  const shown = expanded ? group.items : group.items.slice(0, 3);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-xs text-muted">
          بقيت <span className="nums font-bold">{remaining.length}</span> مجموعة ·{" "}
          <span className="nums">{pendingCount}</span> حركة
        </p>
        <button
          type="button"
          onClick={next}
          className="text-[11px] text-muted underline underline-offset-4 hover:text-ink-soft"
        >
          تخطّها الآن
        </button>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="nums block font-display text-2xl font-bold leading-none">
              <Money minor={group.totalMinor} />
            </span>
            <span className="mt-1.5 block text-[11px] text-muted">
              {countNoun(group.items.length, TRANSACTION)} · يجمعها {group.identityLabel}
            </span>
          </span>
          <Badge tone={group.items.length > 1 ? "warn" : "danger"}>
            {REASON_LABEL[group.items[0].reason]}
          </Badge>
        </div>

        <p className="mt-3 text-sm font-bold leading-snug" dir="auto">{group.title}</p>

        {/*
          الحركات تُعرَض قبل الحسم.

          لأنّ من يُقرّر على سبعٍ لم يرَها لا يُقرّر، بل يوافق.
        */}
        <ul className="mt-2 space-y-1 border-r-2 border-line pr-2.5">
          {shown.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3">
              <span className="nums shrink-0 text-[10px] text-muted">{i.date}</span>
              <span className="clamp-1 min-w-0 flex-1 text-[10px] text-muted" dir="auto">
                {i.description || "بلا وصف"}
              </span>
              <span className="nums shrink-0 text-[11px] font-bold">
                {i.direction === "DEBIT" ? "−" : "+"}
                <Money minor={i.amountMinor} />
              </span>
            </li>
          ))}
        </ul>
        {group.items.length > 3 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 text-[10px] text-muted underline underline-offset-4"
          >
            {expanded ? "اطوِ" : `أظهر الـ${group.items.length} كلّها`}
          </button>
        )}

        {group.guessName && (
          <div className="mt-3 rounded-xl border border-line bg-sunken px-3 py-2.5">
            <p className="text-[11px] text-muted">نعتقد أنّها</p>
            <p className="text-sm font-bold">{group.guessName}</p>
            {group.why.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {group.why.slice(0, 3).map((w, i) => (
                  <li key={i} className="text-[10px] leading-relaxed text-muted">— {w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {single && single.candidates && single.candidates.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold">أيّ فاتورة تفسّرها؟</p>
            <ul className="mt-2 space-y-2">
              {single.candidates.map((c, i) => (
                <li key={i} className="rounded-xl border border-line px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold">{c.label}</span>
                      <span className="block text-[10px] text-muted">
                        {c.why.slice(0, 2).join(" · ")}
                      </span>
                    </span>
                    <span className="nums shrink-0 text-xs font-bold">
                      <Money minor={c.amountMinor} />
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => acceptCandidate(c)}
                    className={`${buttonClass("primary", "sm")} mt-2`}
                  >
                    هذه هي
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy}
              onClick={markNotAPayment}
              className={`${buttonClass("secondary", "sm")} mt-2`}
            >
              ليست سداد فاتورة — دفعة مقدَّمة
            </button>
          </div>
        )}

        {/*
          المورّد معروف: فالسؤال ليس «ما هذه؟» بل «أتُسدَّد على حسابه؟».
          والفواتير تفصيلٌ داخل الحساب لا شرطٌ لقبوله.
        */}
        {group.supplierId && (
          <div className="mt-4 rounded-xl border border-line bg-sunken px-3 py-2.5">
            <p className="text-[11px] text-muted">
              المورّد معروف: <span className="font-bold text-ink">{group.supplierName}</span>
              {typeof group.outstandingMinor === "number" && (
                <>
                  {" "}· عليه الآن <span className="nums font-bold">
                    <Money minor={group.outstandingMinor} />
                  </span>
                </>
              )}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={settleAccount}
              className={`${buttonClass("primary", "sm")} mt-2`}
            >
              {busy ? "يقيّد…" : "سدِّد على حساب المورّد — بالأقدم أوّلاً"}
            </button>
            {/* ما سيحدث يُقال قبل الضغط لا بعده */}
            {typeof group.outstandingMinor === "number" && (
              <p className="nums mt-1.5 text-[11px] text-muted">
                سيُخصَّص{" "}
                <span className="font-bold text-ink">
                  <Money minor={Math.min(group.totalMinor, group.outstandingMinor)} />
                </span>
                {" · ويبقى على حسابه "}
                <span className="font-bold text-ink">
                  <Money minor={Math.max(0, group.outstandingMinor - group.totalMinor)} />
                </span>
                {group.totalMinor > group.outstandingMinor && (
                  <>
                    {" · وغير مخصَّص "}
                    <span className="font-bold text-ink">
                      <Money minor={group.totalMinor - group.outstandingMinor} />
                    </span>
                  </>
                )}
              </p>
            )}
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              لا رقمَ فاتورةٍ في الحوالة — فتُوزَّع على المفتوح بالأقدم أوّلاً،
              وما بقي يبقى غير مخصَّص. ولا تُخترَع فاتورة.
            </p>
          </div>
        )}

        <p className="mt-4 text-xs font-bold">
          {group.items.length > 1 ? "ما هذه الحركات؟" : "ما هذه الحركة؟"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className={`rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                kind === k.value
                  ? "border-ink bg-inverse-surface text-inverse-ink"
                  : "border-line hover:border-ink-soft"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {kind === "SUPPLIER" && (
          <label className="mt-3 block">
            <span className="text-[11px] text-muted">أيّ مورّد؟</span>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-ink"
            >
              <option value="">اختر…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.nameAr}</option>
              ))}
            </select>
          </label>
        )}

        {kind !== null && kind !== "SUPPLIER" && (
          <label className="mt-3 block">
            <span className="text-[11px] text-muted">اسم الجهة (اختياريّ)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              dir="auto"
              placeholder={group.items[0].beneficiaryRaw ?? group.title.slice(0, 40)}
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-ink"
            />
          </label>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={confirm}
            className={buttonClass("primary", "sm")}
          >
            {busy
              ? "يحفظ…"
              : group.items.length > 1
                ? `أكّد — وطبّقها على ${countNoun(group.items.length, TRANSACTION)}`
                : "أكّد وانتقل"}
          </button>
          {message && (
            <span className={`text-[11px] ${failed ? "text-danger" : "text-ok"}`}>{message}</span>
          )}
        </div>

        <p className="mt-3 border-t border-line pt-2.5 text-[10px] leading-relaxed text-muted">
          ما تؤكّده هنا يصير ذاكرةً: تُحفَظ أدلّة هذه الجهة — اسمها وحسابها ورقم
          هويّتها ونمط وصفها — فتُعرَف حركاتها في الكشوف السابقة الآن، وفي القادمة
          بلا سؤال.
        </p>
      </Card>
    </div>
  );
}
