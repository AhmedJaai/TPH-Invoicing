import Link from "next/link";
import { CircleCheck, RotateCcw, ShieldAlert } from "lucide-react";
import { Money } from "./money";
import { Badge, LinkButton, Monogram } from "./ui";
import { PostAction } from "./post-action";
import { groupIban } from "@/lib/bank/iban-guard";
import { ITEM, TRANSACTION, countNoun } from "@/lib/arabic";
import { txHref } from "@/lib/inspector";
import { formatDay } from "@/lib/riyadh-time";
import { loadFirstTransfers, loadIbanAlerts, type FirstTransferRow, type IbanAlertRow } from "@/services/iban-guard.service";
import { T } from "@/components/i18n/t";

/**
 * «حوالةٌ إلى حسابٍ غير حساب المورّد المعروف» — الآيبانان جنباً إلى جنب والمبلغ،
 * ثمّ قرارُ صاحبه. **تنبيهٌ لا منع**: الحوالةُ خرجت، وقد يكون له حسابان؛ فإن كان
 * يعرفه أغلقه بضغطة، وإن غيّر المورّدُ حسابَه فعلاً حدّث ملفَّه.
 */
function IbanLine({ label, iban, tone }: { label: string; iban: string; tone: "danger" | "muted" }) {
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-[11px]">
      <span className="text-muted">{label}</span>
      <bdi dir="ltr" className={`nums text-xs font-bold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{groupIban(iban)}</bdi>
    </span>
  );
}

export function IbanAlertCard({ alert: a, canEdit }: { alert: IbanAlertRow; canEdit: boolean }) {
  const decided = a.decision !== null;
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <Monogram name={a.supplierName} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/suppliers/${a.supplierSlug}`} className="text-[14px] font-bold hover:underline" dir="auto">{a.supplierName}</Link>
            {decided && <Badge tone="ok" dot>حساب تعرفه للمورّد</Badge>}
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
            {a.kind === "DIFFERS_FROM_SAVED"
              ? "يخالف الآيبان المسجّل في صفحة المورّد"
              : "حساب لم يُحوَّل إليه من قبل، وتحويلاته السابقة كانت إلى حساب آخر"}
            {" · "}{countNoun(a.transfers.length, TRANSACTION)}
          </span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-[11px] text-muted">المبلغ المحوَّل</span>
          <span className={`block text-[15px] font-bold ${decided ? "text-ink-soft" : "text-danger"}`}><Money minor={a.totalMinor} /></span>
        </span>
      </div>

      <div className="mt-3 divide-y divide-line-soft rounded-lg border border-line-soft bg-sunken/60 sm:ms-11">
        <IbanLine label="حُوِّل المبلغ إلى" iban={a.seenIban} tone={decided ? "muted" : "danger"} />
        {a.knownIbans.map((k) => (
          <IbanLine key={k} label={a.kind === "DIFFERS_FROM_SAVED" ? "المسجّل في صفحة المورّد" : "الحساب الذي حُوِّل إليه سابقاً"} iban={k} tone="muted" />
        ))}
        <ul className="divide-y divide-line-soft">
          {a.transfers.slice(-4).map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-[11px]">
              <Link href={txHref(t.id)} className="font-bold text-accent hover:underline"><T s="حوالة {0}" a={[formatDay(t.day)]} /></Link>
              <span className="text-xs font-bold"><Money minor={t.amountMinor} /></span>
            </li>
          ))}
        </ul>
        {a.decision?.note && <p className="px-3 py-2 text-[11px] text-ink-soft" dir="auto"><T s="ملاحظتك: {0}" a={[a.decision.note]} /></p>}
      </div>

      {!decided && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft sm:ps-11">
          إن وصلتك رسالة بتغيير الحساب، فاتصل بالمورّد على رقمه الذي تعرفه لا على رقم في الرسالة، وذلك قبل أي تحويل آخر.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:ps-11">
        {canEdit && !decided && (
          <PostAction
            url="/api/iban-guard"
            body={{ supplierId: a.supplierId, iban: a.seenIban, decision: "KNOWN" }}
            undo={{ body: { supplierId: a.supplierId, iban: a.seenIban, decision: "OPEN" } }}
            variant="primary"
          >
            <T s="{0}أعرفه، هذا حساب المورّد" a={[<CircleCheck key="0" className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />]} /></PostAction>
        )}
        {!decided && (
          <LinkButton href={`/suppliers/${a.supplierSlug}`} size="sm">غيّر المورّد حسابه؟ حدّث صفحته</LinkButton>
        )}
        {canEdit && decided && (
          <PostAction
            url="/api/iban-guard"
            body={{ supplierId: a.supplierId, iban: a.seenIban, decision: "OPEN" }}
            undo={{ body: { supplierId: a.supplierId, iban: a.seenIban, decision: "KNOWN" } }}
            variant="quiet"
          >
            <T s="{0}أعد فتح التنبيه" a={[<RotateCcw key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></PostAction>
        )}
      </div>
    </div>
  );
}

export async function IbanGuardWorkspace({ canEdit }: { canEdit: boolean }) {
  const all = await loadIbanAlerts();
  const open = all.filter((a) => a.decision === null);
  const closed = all.filter((a) => a.decision !== null);
  return (
    <>
      {open.length === 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-xs font-bold text-ok">
          <T s="{0}لا توجد حوالات إلى حساب غير الحساب المعروف." a={[<CircleCheck key="0" className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />]} /></p>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
          {open.map((a) => <li key={a.key}><IbanAlertCard alert={a} canEdit={canEdit} /></li>)}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-bold text-muted hover:text-ink sm:min-h-0">
            <T s="{0}ما أغلقته ({1}). يمكنك إعادة فتحه" a={[<ShieldAlert key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />, countNoun(closed.length, ITEM)]} /></summary>
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised/70">
            {closed.map((a) => <li key={a.key}><IbanAlertCard alert={a} canEdit={canEdit} /></li>)}
          </ul>
        </details>
      )}
    </>
  );
}

/* ───────────────────── أوّلُ حوالةٍ إلى حسابٍ جديد ───────────────────── */

function FirstTransferCard({ row: f, canEdit }: { row: FirstTransferRow; canEdit: boolean }) {
  const decided = f.decision !== null;
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <Monogram name={f.payee ?? "؟"} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold" dir="auto">{f.payee ?? "مستفيد غير معروف"}</span>
            {decided && <Badge tone="ok" dot>مستفيد تعرفه</Badge>}
          </span>
          <bdi dir="ltr" className="nums mt-0.5 block text-xs text-ink-soft">{groupIban(f.iban)}</bdi>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-[11px] text-muted">المبلغ المحوَّل إليه</span>
          <span className="block text-[15px] font-bold"><Money minor={f.totalMinor} /></span>
        </span>
      </div>
      <ul className="mt-3 divide-y divide-line-soft rounded-lg border border-line-soft bg-sunken/60 sm:ms-11">
        {f.transfers.slice(-4).map((t) => (
          <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-[11px]">
            <Link href={txHref(t.id)} className="font-bold text-accent hover:underline"><T s="حوالة {0}" a={[formatDay(t.day)]} /></Link>
            <span className="text-xs font-bold"><Money minor={t.amountMinor} /></span>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2 sm:ps-11">
          {decided ? (
            <PostAction url="/api/iban-guard" body={{ iban: f.iban, decision: "OPEN" }} undo={{ body: { iban: f.iban, decision: "KNOWN" } }} variant="quiet">
              <T s="{0}أعد فتح التنبيه" a={[<RotateCcw key="0" className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />]} /></PostAction>
          ) : (
            <PostAction url="/api/iban-guard" body={{ iban: f.iban, decision: "KNOWN" }} undo={{ body: { iban: f.iban, decision: "OPEN" } }} variant="primary">
              <T s="{0}أعرفه" a={[<CircleCheck key="0" className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />]} /></PostAction>
          )}
        </div>
      )}
    </div>
  );
}

export async function FirstTransferWorkspace({ canEdit }: { canEdit: boolean }) {
  const all = await loadFirstTransfers();
  const open = all.filter((f) => f.decision === null);
  const closed = all.filter((f) => f.decision !== null);
  return (
    <>
      {open.length === 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-xs font-bold text-ok">
          <T s="{0}لا يوجد مستفيد جديد ينتظر قرارك." a={[<CircleCheck key="0" className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />]} /></p>
      ) : (
        <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
          {open.map((f) => <li key={f.key}><FirstTransferCard row={f} canEdit={canEdit} /></li>)}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-bold text-muted hover:text-ink sm:min-h-0">
            <T s="مستفيدون أكدت أنك تعرفهم ({0}). يمكنك إعادة فتح أي منهم" a={[countNoun(closed.length, ITEM)]} /></summary>
          <ul className="mt-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised/70">
            {closed.map((f) => <li key={f.key}><FirstTransferCard row={f} canEdit={canEdit} /></li>)}
          </ul>
        </details>
      )}
    </>
  );
}
