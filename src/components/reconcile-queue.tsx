"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, CircleAlert, CircleCheck, Lightbulb, SkipForward, Store, Wallet } from "lucide-react";
import { Money } from "./money";
import { Badge, Meter, Monogram, buttonClass, type Tone } from "./ui";
import { toast } from "./ui-client";
import { countNoun, TRANSACTION } from "@/lib/arabic";
import { postJson } from "@/lib/http-client";
import { ACT } from "@/lib/ui-terms";
import { formatDay } from "@/lib/riyadh-time";

/**
 * حلّ المعلّقات — **مجموعةً مجموعة** لا حركةً حركة.
 *
 * كشفٌ فيه ستّون حركة، خمسَ عشرة منها لمورّدٍ واحد، كان يعني خمسة عشر
 * سؤالاً عن شيءٍ واحد — فيُترَك الطابور. فالسؤال: **ما هذه السبع؟** ثمّ
 * تُحسَم بضغطة، وما يُجاب به يُحفَظ هويّةً للجهة فتُعرَف أخواتُها الآن وفي
 * الكشوف القادمة بلا سؤال.
 *
 * والتجميعُ في الخادم لا هنا: هو الذي يشتقّ الهويّة، وهو الذي يتحقّق منها
 * ثانيةً قبل الكتابة. وهذه الشاشة تعرض ما جمعه، وتنتظر ردّه قبل أن تنتقل.
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
  SUGGESTED: "اقتراح ينتظر تأكيدك",
  APPROXIMATE: "حلٌّ تقريبيّ",
  KNOWN_SUPPLIER_NO_INVOICE: "المورّد معروف ولا فاتورة تقابله",
};

const REASON_TONE: Record<QueueReason, Tone> = {
  UNKNOWN_ENTITY: "danger",
  CLOSE_CANDIDATES: "warn",
  AMOUNT_MISMATCH: "warn",
  PARTIAL_PAYMENT: "warn",
  OVERPAYMENT: "warn",
  SUGGESTED: "accent",
  APPROXIMATE: "warn",
  KNOWN_SUPPLIER_NO_INVOICE: "info",
};

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
}

/**
 * مجموعةٌ من الحركات يجمعها دليلٌ واحد. و`identityLabel` جوابُ «لماذا
 * اجتمعت هذه؟» — ومن لا يعرف لماذا اجتمعت لا ينبغي أن يحسمها دفعةً واحدة.
 */
export interface QueueGroup {
  key: string;
  identityLabel: string;
  title: string;
  totalMinor: number;
  items: QueueItem[];
  guessName: string | null;
  why: string[];
  /** المورّد إن اجتمعت المجموعة عليه — وبه يُتاح السداد على حسابه. */
  supplierId?: string | null;
  supplierName?: string | null;
  /** ما عليه الآن — من المصدر الواحد لـ«عليك». */
  outstandingMinor?: number;
}

export interface SupplierOption {
  id: string;
  nameAr: string;
}

/*
  البابان منفصلان في العرض: «سدادُ مورّد» يبدأ عملاً (أيّ فاتورة؟)،
  وما عداه يُنهي أمرَ الحركة. فخلطُهما في صفٍّ واحد يُخفي الفرق.
*/
const NOT_SUPPLIER: { value: string; label: string }[] = [
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
  canApprove = true,
  canEdit = true,
}: {
  groups: readonly QueueGroup[];
  suppliers: readonly SupplierOption[];
  /** السداد على حساب المورّد يحتاج `payment:approve` — والزرّ لا يُعرض لمن لا يملكه. */
  canApprove?: boolean;
  /** تعريف الجهة يحتاج `bank:edit`. */
  canEdit?: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"settle" | "advance" | "identify" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  const remaining = groups.filter((g) => !done.has(g.key));
  const group = remaining[0];
  const pendingCount = remaining.reduce((n, g) => n + g.items.length, 0);
  const pendingMinor = remaining.reduce((n, g) => n + g.totalMinor, 0);

  if (!group) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-ok/25 bg-ok-bg px-5 py-5">
        <CircleCheck className="h-6 w-6 shrink-0 text-ok" strokeWidth={2} aria-hidden />
        <div>
          <p className="text-sm font-bold text-ok">انتهت المجموعات.</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            ما أجبتَ عنه صار ذاكرةً: يُعرَف به ما يشبهه في الكشوف القادمة بلا سؤال.
          </p>
        </div>
      </div>
    );
  }

  function next() {
    setDone((d) => new Set(d).add(group!.key));
    setKind(null);
    setSupplierId("");
    setName("");
    setExpanded(false);
    setError(null);
  }

  /** يُنتظَر ردُّ الخادم ثمّ يُنتقَل — لا تقدّمَ متفائلاً عن كتابةٍ لم تقع. */
  async function post(
    which: "settle" | "advance" | "identify",
    url: string,
    payload: unknown,
    onOk: (message: string) => void,
  ) {
    setBusy(which);
    setError(null);
    try {
      const r = await postJson<{ message?: string }>(url, payload);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onOk(r.data.message ?? "حُفظ");
      next();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const single = group.items.length === 1 ? group.items[0] : null;

  /**
   * التراجعُ من الإشعار لحركةٍ واحدة وحدها — طلبٌ واحد يُفكّ أو لا يُفكّ.
   * وللمجموعة طلباتٌ بعددها، فقد ينجح بعضها ويفشل بعضها ويقول الإشعار «لم
   * يتغيّر شيء» كاذباً. فتُفكّ المجموعةُ من السجلّ حركةً حركة.
   */
  const undoOne = (txId: string) => ({
    run: async () => {
      const u = await postJson("/api/match-undo", { transactionId: txId, reason: "تراجع من إشعار الطابور" });
      if (u.ok) router.refresh();
      return u.ok;
    },
  });

  const markAdvance = () =>
    post("advance", "/api/match-confirm", { transactionId: single!.id, notAPayment: "ADVANCE" }, (message) =>
      toast({ tone: "ok", title: message, undo: undoOne(single!.id) }),
    );

  /**
   * سدادٌ على حساب المورّد — لا على فاتورةٍ بعينها. بعض المورّدين لا يعطون
   * فاتورةً أصلاً، فالحوالة سدادٌ لحسابه تُوزَّع بالأقدم أوّلاً. والمجموعة
   * تُرسَل معاً فيقيّدها الخادم في معاملةٍ واحدة لا نصفَ مقيَّدة.
   */
  const settleAccount = () =>
    post("settle", "/api/match-confirm", {
      transactionId: group.items[0].id,
      transactionIds: group.items.map((i) => i.id),
      settleSupplier: true,
    }, (message) =>
      toast({
        tone: "ok",
        title: message,
        body: single ? undefined : "للتراجع افتح أيّاً منها في سجلّ الحركات أدناه، ثمّ «لماذا؟».",
        undo: single ? undoOne(single.id) : undefined,
      }),
    );

  /** يعرّف المجموعة كلّها — والخادم يعيد التحقّق من أنّها مجموعة. */
  const identify = () =>
    post("identify", "/api/counterparty", {
      transactionIds: group.items.map((i) => i.id),
      kind,
      supplierId: kind === "SUPPLIER" ? supplierId : null,
      displayName: name.trim() || group.items[0].beneficiaryRaw || undefined,
    }, (message) => toast({ tone: "ok", title: message, body: "ويُعرَف به ما يشبهها في الكشوف القادمة." }));

  const ready = kind !== null && (kind !== "SUPPLIER" || supplierId !== "");
  const shown = expanded ? group.items : group.items.slice(0, 4);
  const reason = group.items[0].reason;
  const doneCount = groups.length - remaining.length;

  return (
    <div>
      {/* ── التقدّم: كم بقي، وبأيّ مبلغ ── */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-muted">
          <span className="font-bold text-ink">المجموعة <span className="nums">{doneCount + 1}</span> من <span className="nums">{groups.length}</span></span>
          {" · "}بقي {countNoun(pendingCount, TRANSACTION)} بـ<Money minor={pendingMinor} />
        </p>
        <div className="min-w-24 flex-1">
          <Meter value={doneCount} max={groups.length} label="ما حُسم من المجموعات" />
        </div>
        <button
          type="button"
          onClick={next}
          disabled={busy !== null}
          className={buttonClass("quiet", "sm")}
        >
          <SkipForward className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          تخطّها الآن
        </button>
      </div>

      <article className="overflow-hidden rounded-2xl border border-line bg-raised shadow-lifted">
        {/* ── الرأس: من، وكم، ولماذا تُسأل ── */}
        <header className="flex flex-wrap items-start gap-3 border-b border-line-soft px-4 py-4 sm:px-5">
          <Monogram name={group.title} className="h-10 w-10 text-base" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-snug" dir="auto">{group.title}</p>
            <p className="mt-1 text-[11px] text-muted">
              {countNoun(group.items.length, TRANSACTION)} · يجمعها {group.identityLabel}
            </p>
            <div className="mt-2">
              <Badge tone={REASON_TONE[reason]} dot>{REASON_LABEL[reason]}</Badge>
            </div>
          </div>
          <p className="text-[1.6rem] font-bold leading-none tracking-tight"><Money minor={group.totalMinor} currency /></p>
        </header>

        {/* الحركاتُ تُعرَض قبل الحسم — من يقرّر على سبعٍ لم يرَها لا يقرّر، بل يوافق */}
        <ul className="divide-y divide-line-soft bg-sunken/40">
          {shown.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2 text-xs sm:px-5">
              <bdi className="w-24 shrink-0 text-muted">{formatDay(i.date)}</bdi>
              <span className="min-w-0 flex-1 truncate text-ink-soft" dir="auto" title={i.description}>
                {i.description || "بلا وصف"}
              </span>
              <span className="nums-col shrink-0 font-bold">
                <span className="sr-only">{i.direction === "DEBIT" ? "صادر" : "وارد"}</span>
                <span dir="ltr">{i.direction === "DEBIT" ? "−" : "+"}<Money minor={i.amountMinor} /></span>
              </span>
            </li>
          ))}
        </ul>
        {group.items.length > 4 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex min-h-11 w-full items-center justify-center gap-1 border-t border-line-soft text-xs font-bold text-ink-soft hover:bg-hover sm:min-h-9"
          >
            {expanded ? "اطوِ" : `أظهر الـ${group.items.length} كلّها`}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} strokeWidth={2} aria-hidden />
          </button>
        )}

        <div className="space-y-4 px-4 py-4 sm:px-5">
          {group.guessName && (
            <div className="flex gap-3 rounded-xl border border-accent-line bg-accent-soft/50 px-4 py-3">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden />
              <div className="min-w-0">
                <p className="text-[11px] text-muted">ترجيحُ النظام — لا حكمٌ</p>
                <p className="text-sm font-bold">{group.guessName}</p>
                {group.why.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {group.why.slice(0, 3).map((w, i) => (
                      <li key={i} className="text-[11px] leading-relaxed text-ink-soft" dir="auto">— {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/*
            المورّد معروف: فالسؤال ليس «ما هذه؟» بل «أتُسدَّد على حسابه؟».
            وما سيحدث يُقال قبل الضغط لا بعده.
          */}
          {group.supplierId && canApprove && (
            <section aria-label="السداد على حساب المورّد" className="rounded-xl border border-line px-4 py-3.5">
              <p className="flex items-center gap-2 text-xs text-muted">
                <Store className="h-4 w-4 text-ink-soft" strokeWidth={2} aria-hidden />
                المورّد معروف: <span className="font-bold text-ink">{group.supplierName}</span>
              </p>
              {typeof group.outstandingMinor === "number" && (
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <Cell label="عليك له الآن" minor={group.outstandingMinor} />
                  <Cell label="سيُخصَّص" minor={Math.min(group.totalMinor, group.outstandingMinor)} strong />
                  {group.totalMinor > group.outstandingMinor
                    ? <Cell label="يبقى غير مخصَّص" minor={group.totalMinor - group.outstandingMinor} />
                    : <Cell label="يبقى عليك" minor={Math.max(0, group.outstandingMinor - group.totalMinor)} />}
                </dl>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button aria-busy={busy === "settle"} type="button" disabled={busy !== null} onClick={settleAccount} className={buttonClass("primary", "sm")}>
                  <Wallet className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  {ACT.settleOnAccount}
                </button>
                {single && (
                  <button aria-busy={busy === "advance"} type="button" disabled={busy !== null} onClick={markAdvance} className={buttonClass("secondary", "sm")}>
                    دفعة مقدَّمة — قبل فاتورتها
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                لا رقمَ فاتورةٍ في الحوالة — فتُوزَّع على المفتوح بالأقدم أوّلاً، وما بقي يبقى غير مخصَّص. ولا تُخترَع فاتورة.
              </p>
            </section>
          )}

          {canEdit && (
            <section aria-label="تعريف الجهة">
              <p className="text-xs font-bold">
                {group.supplierId ? "أو عرّفها بغير ذلك" : group.items.length > 1 ? "ما هذه الحركات؟" : "ما هذه الحركة؟"}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="باب الحركة">
                <Chip value="SUPPLIER" label="سداد مورّد" kind={kind} setKind={setKind} disabled={busy !== null} strong />
                <span aria-hidden className="mx-1 hidden w-px self-stretch bg-line sm:block" />
                {NOT_SUPPLIER.map((k) => (
                  <Chip key={k.value} value={k.value} label={k.label} kind={kind} setKind={setKind} disabled={busy !== null} />
                ))}
              </div>

              {kind === "SUPPLIER" && (
                <label className="mt-3 block">
                  <span className="text-[11px] font-bold text-muted">أيّ مورّد؟</span>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm sm:min-h-10"
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
                  <span className="text-[11px] font-bold text-muted">اسم الجهة (اختياريّ)</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    dir="auto"
                    placeholder={group.items[0].beneficiaryRaw ?? group.title.slice(0, 40)}
                    className="mt-1 min-h-11 w-full rounded-lg border border-line-input bg-raised px-3 text-sm placeholder:text-muted sm:min-h-10"
                  />
                </label>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" aria-busy={busy === "identify"} disabled={!ready || busy !== null} onClick={identify} className={buttonClass(group.supplierId ? "secondary" : "primary", "sm")}>
                  {group.items.length > 1
                      ? `${ACT.defineGroup} — وطبّقها على ${countNoun(group.items.length, TRANSACTION)}`
                      : ACT.saveIdentityAndNext}
                </button>
                {!ready && kind === "SUPPLIER" && <span className="text-[11px] text-muted">اختر المورّد أوّلاً.</span>}
              </div>
            </section>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-bold text-danger">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              {error} — لم يُكتب شيء، والمجموعة باقية.
            </p>
          )}
        </div>

        <footer className="border-t border-line-soft bg-sunken/40 px-4 py-2.5 text-[11px] leading-relaxed text-muted sm:px-5">
          ما تؤكّده يصير ذاكرة: تُحفَظ أدلّةُ الجهة — اسمُها وحسابُها ونمطُ وصفها — فيُطبَّق الآن على ما اخترتَه، ويُعرَف
          ما يشبهه في الكشوف القادمة بلا سؤال.
        </footer>
      </article>
    </div>
  );
}

function Cell({ label, minor, strong = false }: { label: string; minor: number; strong?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-2 ${strong ? "bg-accent-soft" : "bg-sunken"}`}>
      <dt className="text-[10px] font-bold text-muted">{label}</dt>
      <dd className={`mt-0.5 text-[13px] font-bold ${strong ? "text-accent" : ""}`}><Money minor={minor} /></dd>
    </div>
  );
}

function Chip({
  value, label, kind, setKind, disabled, strong = false,
}: {
  value: string;
  label: string;
  kind: string | null;
  setKind: (v: string) => void;
  disabled: boolean;
  strong?: boolean;
}) {
  const on = kind === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      /* الباب لا يتغيّر أثناء الحفظ — وإلّا حُفظ بابٌ وظهر غيره (BTN-115) */
      disabled={disabled}
      onClick={() => setKind(value)}
      className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-xs font-bold transition-colors disabled:opacity-50 sm:min-h-8 ${
        on
          ? "border-accent bg-accent text-accent-ink"
          : strong
            ? "border-accent-line bg-accent-soft text-accent hover:border-accent"
            : "border-line bg-raised text-ink-soft hover:border-line-input hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
