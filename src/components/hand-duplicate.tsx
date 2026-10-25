import Link from "next/link";
import { CircleCheck, Copy } from "lucide-react";
import { Money } from "./money";
import { Monogram } from "./ui";
import { PostAction } from "./post-action";
import { HandDuplicateVoid } from "./hand-duplicate-void";
import { METHOD_LABEL } from "@/lib/payment-state";
import { formatDay } from "@/lib/riyadh-time";
import { loadDuplicateHandPayments, type DuplicateHandView } from "@/services/hand-duplicate.service";
import { T } from "@/components/i18n/t";

/** أرقامُ الفواتير اللاتينيّة («0092-006-16895») تُعزل في السطر العربيّ فلا ينقلب ترتيبُها. */
function Isolated({ text }: { text: string }) {
  return <>{text.split(/([A-Za-z0-9][A-Za-z0-9/_.-]*)/).map((part, i) => (i % 2 === 1 ? <bdi key={i} className="nums">{part}</bdi> : part))}</>;
}

/**
 * «دفعةٌ قُيّدت مرّتين بيدك — يظهر لك عند المورّد رصيدٌ ليس لك» (`hand-duplicate.service.ts`).
 *
 * الدفعةُ ودليلُ تكرارها، ثمّ قرارُ المالك: «ألغِ القيد المكرّر» (معاينةٌ ثمّ تأكيد) أو
 * «هي دفعةٌ حقيقيّة — أبقِها رصيداً». **تنبيهٌ لا إلغاءٌ آليّ.**
 */
export function HandDuplicateCard({ d, canAct, showSupplier = true }: { d: DuplicateHandView; canAct: boolean; showSupplier?: boolean }) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        {showSupplier && <Monogram name={d.supplierName} />}
        <span className="min-w-0 flex-1">
          {showSupplier && (
            <Link href={`/suppliers/${d.supplierSlug}`} className="block text-[14px] font-bold hover:underline" dir="auto">{d.supplierName}</Link>
          )}
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
            {formatDay(d.day)} · {METHOD_LABEL[d.method] ?? d.method} · بلا حوالة في الكشف ولا إيصال
          </span>
          <span className="mt-1 block text-[12px] leading-relaxed text-ink-soft"><Isolated text={d.why} />.</span>
        </span>
        <span className="shrink-0 text-end">
          <span className="block text-[11px] text-muted">يظهر رصيداً لك</span>
          <span className="block text-[15px] font-bold text-warn"><Money minor={d.creditMinor} /></span>
        </span>
      </div>
      {canAct ? (
        <div className={`mt-3 flex flex-wrap items-start gap-2 ${showSupplier ? "sm:ps-11" : ""}`}>
          <HandDuplicateVoid paymentId={d.paymentId} supplierName={d.supplierName} />
          <PostAction
            url="/api/hand-duplicate"
            body={{ action: "keep", paymentId: d.paymentId }}
            undo={{ body: { action: "reopen", paymentId: d.paymentId } }}
            variant="quiet"
          >
            هي دفعة حقيقية، أبقِها رصيداً
          </PostAction>
        </div>
      ) : (
        <p className={`mt-2 text-[11px] text-muted ${showSupplier ? "sm:ps-11" : ""}`}>إلغاء القيد المكرّر للمالك.</p>
      )}
    </div>
  );
}

/** لوحُ البند في «يحتاج قرارك» — كلُّ مورّدٍ بدفعاته. */
export async function HandDuplicateWorkspace({ canAct }: { canAct: boolean }) {
  const list = await loadDuplicateHandPayments();
  if (list.length === 0) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-xl border border-ok/25 bg-ok-bg px-4 py-3 text-xs font-bold text-ok">
        <T s="{0}لا توجد دفعة مسجّلة مرتين بيدك." a={[<CircleCheck key="0" className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />]} /></p>
    );
  }
  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-raised shadow-raised">
      {list.map((d) => <li key={d.key}><HandDuplicateCard d={d} canAct={canAct} /></li>)}
    </ul>
  );
}

/** بجانب «رصيد لك عنده» في صفحة المورّد — ما فيه من قيدٍ مكرّر. */
export function SupplierHandDuplicates({ list, canAct }: { list: DuplicateHandView[]; canAct: boolean }) {
  if (list.length === 0) return null;
  const total = list.reduce((n, d) => n + d.creditMinor, 0);
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-warn/30 bg-warn-bg">
      <p className="flex items-start gap-2 px-3 py-2 text-[11px] font-bold leading-relaxed text-warn">
        <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
        <span>
          <T s="{0} من هذا الرصيد دفعة قُيّدت مرتين بيدك، وليست مالاً لك عند المورّد." a={[<Money key="0" minor={total} />]} />
        </span>
      </p>
      <ul className="divide-y divide-line-soft border-t border-warn/20 bg-raised">
        {list.map((d) => <li key={d.key}><HandDuplicateCard d={d} canAct={canAct} showSupplier={false} /></li>)}
      </ul>
    </div>
  );
}
