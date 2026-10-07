"use client";

/**
 * يضمّ حركةَ بنكٍ إلى إقرار الضريبة أو يُخرجها — مربّعٌ في صفّها، وزرٌّ لمجموعة.
 *
 * يرسل المعرّفات والقرار وحدهما؛ والخادمُ يعيد الحساب ويُرسَم من جديد (`router.refresh`).
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postJson } from "@/lib/http-client";
import { ActionButton, ConfirmAction, Reveal, toast } from "./ui-client";
import { buttonClass } from "./ui-tokens";

type Kind = "tx" | "invoice";

async function send(ids: readonly string[], included: boolean | null, kind: Kind = "tx"): Promise<boolean> {
  const res = await postJson("/api/vat-choice", { kind, ids, included });
  if (!res.ok) {
    toast({ title: "لم يُحفَظ الاختيار", body: res.error, tone: "danger" });
    return false;
  }
  return true;
}

export function VatTxToggle({
  id,
  included,
  locked,
  label,
}: {
  id: string;
  included: boolean;
  /** سببُ المنع إن كانت لا تُضمّ — فاتورتُها محسوبة. */
  locked?: string;
  label: string;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, start] = useTransition();
  const checked = optimistic ?? included;

  async function toggle() {
    if (locked || pending) return;
    const next = !checked;
    setOptimistic(next);
    const ok = await send([id], next);
    if (!ok) { setOptimistic(null); return; }
    start(() => { router.refresh(); });
  }

  return (
    <label
      title={locked}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center sm:min-h-0 sm:min-w-0 ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--accent)]"
        checked={checked}
        disabled={Boolean(locked)}
        aria-busy={pending}
        aria-label={locked ? `${label} — ${locked}` : `احسب ${label} في الإقرار`}
        onChange={toggle}
      />
    </label>
  );
}

/** فعلٌ على مجموعة: «ضمّ كلّ الكهرباء» أو «أعد الكلّ إلى الأصل». */
export function VatBulk({
  ids,
  included,
  children,
  variant = "secondary",
  kind = "tx",
  confirm,
}: {
  ids: readonly string[];
  included: boolean | null;
  children: React.ReactNode;
  variant?: "secondary" | "quiet" | "subtle";
  kind?: Kind;
  /** أثرُ الفعل قبل أن يقع — لما يُدخل عشراتِ الفواتير الخصمَ بإقرارٍ واحد. */
  confirm?: { title: string; consequence: string; acknowledgement: string };
}) {
  const router = useRouter();
  const [, start] = useTransition();
  if (confirm) {
    return (
      <ConfirmAction
        label={typeof children === "string" ? children : "نفِّذ"}
        title={confirm.title}
        consequence={confirm.consequence}
        acknowledgement={confirm.acknowledgement}
        confirmLabel="أقرّ واحسبها"
        variant={variant}
        tone="warn"
        disabled={ids.length === 0}
        onConfirm={async () => {
          const ok = await send(ids, included, kind);
          if (ok) start(() => { router.refresh(); });
          return ok;
        }}
      />
    );
  }
  return (
    <ActionButton
      size="sm"
      variant={variant}
      disabled={ids.length === 0}
      reason="لا حركةَ يتغيّر اختيارُها"
      onAction={async () => {
        const ok = await send(ids, included, kind);
        if (ok) start(() => { router.refresh(); });
        return ok;
      }}
    >
      {children}
    </ActionButton>
  );
}

const FIELD = "nums min-h-11 w-full rounded-lg border border-line-input bg-raised px-2.5 text-sm sm:min-h-9";

async function act(body: Record<string, unknown>, failTitle: string): Promise<boolean> {
  const res = await postJson("/api/vat-return", body);
  if (!res.ok) {
    toast({ title: failTitle, body: res.error, tone: "danger" });
    return false;
  }
  return true;
}

/**
 * مبيعاتُ النقد التي لم تُودَع لشهر — تُكتب شاملةَ الضريبة، والخادمُ يحوّلها هللاتٍ ويحسب.
 * الفارغُ «لم يُكتب» لا صفر.
 */
export function VatCashField({ month, label, initial, locked }: {
  month: string;
  label: string;
  /** ما كُتب من قبل بالريال نصّاً — فارغٌ لم يُكتب. */
  initial: string;
  locked?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [, start] = useTransition();
  const dirty = value.trim() !== initial;
  return (
    <div className="flex items-end gap-2">
      <label className="block min-w-0 flex-1">
        <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          dir="ltr"
          placeholder="لم يُكتب"
          disabled={Boolean(locked)}
          title={locked}
          className={FIELD}
        />
      </label>
      <ActionButton
        size="sm"
        disabled={!dirty || Boolean(locked)}
        reason={locked ?? "لم يتغيّر المبلغ"}
        onAction={async () => {
          const ok = await act({ action: "cash", month, amount: value.trim() || null }, "لم يُحفَظ مبلغُ النقد");
          if (ok) start(() => { router.refresh(); });
          return ok;
        }}
      >
        احفظ
      </ActionButton>
    </div>
  );
}

/**
 * «قدّمتُه»: يسجّل أنّ إقرار الربع قُدِّم — فيُحفَظ رقمُه كما هو الآن وتُقفل اختياراتُه.
 * الأرقامُ يحسبها الخادم؛ من هنا يومُ التقديم والمرجعُ وما فُعل بالرصيد الدائن.
 */
export function VatFilePanel({ period, today, credit, disabled }: {
  period: string;
  today: string;
  /** الصافي رصيدٌ لك — فيُسأل: ترحيلٌ أم استرداد. */
  credit: boolean;
  /** لماذا لا يُقدَّم الآن. */
  disabled?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filedOn, setFiledOn] = useState(today);
  const [reference, setReference] = useState("");
  const [disposition, setDisposition] = useState<"CARRY" | "REFUND" | null>(null);
  const [, start] = useTransition();
  const missing = credit && disposition === null;

  return (
    <div>
      {!open && (
        <button
          type="button"
          disabled={Boolean(disabled)}
          title={disabled}
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className={buttonClass("primary", "sm")}
        >
          قدّمتُه للهيئة
        </button>
      )}
      <Reveal open={open}>
        <div className="space-y-3 rounded-xl border border-line bg-raised p-4">
          <p className="text-sm font-bold">تسجيلُ تقديم الإقرار</p>
          <p className="text-xs leading-relaxed text-ink-soft">
            يُحفَظ الرقمُ كما هو الآن وتُقفل اختياراتُ الربع، وما يتغيّر بعده يُعرض «فرقاً منذ التقديم». التقديمُ نفسُه في بوّابة الهيئة.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">يوم التقديم</span>
              <input type="date" value={filedOn} max={today} onChange={(e) => setFiledOn(e.target.value)} className={FIELD} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">رقم مرجع الإقرار في البوّابة (اختياريّ)</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} dir="ltr" maxLength={64} className={FIELD} />
            </label>
          </div>
          {credit && (
            <fieldset>
              <legend className="mb-1 text-[11px] font-medium text-muted">الصافي رصيدٌ لك — ماذا اخترتَ في البوّابة؟</legend>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {([["CARRY", "يُرحَّل للربع التالي"], ["REFUND", "طلبتُ استردادَه"]] as const).map(([v, text]) => (
                  <label key={v} className="flex min-h-11 items-center gap-2 sm:min-h-0">
                    <input type="radio" name={`vat-credit-${period}`} checked={disposition === v} onChange={() => setDisposition(v)} className="h-4 w-4 accent-[var(--accent)]" />
                    {text}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="flex flex-wrap gap-2">
            <ActionButton
              size="sm"
              variant="primary"
              disabled={missing || !filedOn}
              reason={missing ? "اختر ما فُعل بالرصيد" : "اكتب يومَ التقديم"}
              onAction={async () => {
                const ok = await act({ action: "file", period, filedOn, reference: reference.trim() || null, creditDisposition: credit ? disposition : null }, "لم يُسجَّل التقديم");
                if (ok) {
                  toast({ title: "سُجّل تقديمُ الإقرار", body: "حُفظ رقمُه وأُقفلت اختياراتُ الربع.", tone: "ok" });
                  setOpen(false);
                  start(() => { router.refresh(); });
                }
                return ok;
              }}
            >
              سجّل التقديم
            </ActionButton>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("quiet", "sm")}>تراجع</button>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** التراجعُ عن تسجيل التقديم — بسببٍ مكتوب؛ اللقطةُ تبقى في السجلّ وتُفتح الاختيارات. */
export function VatVoidFiling({ period }: { period: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [, start] = useTransition();
  return (
    <div>
      {!open && (
        <button type="button" aria-expanded={false} onClick={() => setOpen(true)} className={buttonClass("quiet", "sm")}>
          تراجع عن تسجيل التقديم
        </button>
      )}
      <Reveal open={open}>
        <div className="space-y-3 rounded-xl border border-warn/30 bg-warn-bg p-4">
          <p className="text-xs leading-relaxed text-ink-soft">
            يفتح اختياراتِ الربع فيتغيّر رقمُه بما تغيّر بعد التقديم. اللقطةُ المحفوظة تبقى في السجلّ بسبب التراجع. ولا يغيّر شيئاً عند الهيئة.
          </p>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">سببُ التراجع</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={FIELD} />
          </label>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              size="sm"
              variant="danger"
              disabled={reason.trim().length < 3}
              reason="اكتب السبب"
              onAction={async () => {
                const ok = await act({ action: "void", period, reason: reason.trim() }, "لم يقع التراجع");
                if (ok) { setOpen(false); start(() => { router.refresh(); }); }
                return ok;
              }}
            >
              تراجع عن التسجيل
            </ActionButton>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("quiet", "sm")}>أبقِه</button>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
