import { loadUnbackedPayments } from "@/services/supplier-followups.service";
import { findCreditNoteEvidence } from "@/services/unbacked-credit.service";
import { formatRiyalsDisplay } from "@/lib/money";
import { formatDay } from "@/lib/riyadh-time";
import { SettleFromCredit } from "./settle-from-credit";
import { T } from "@/components/i18n/t";

/**
 * «سدّد بها فواتيره المفتوحة» في **حساب المورّد نفسه**، حيث يُقال له «متوازن على الورق».
 *
 * كان الزرُّ في بند «يحتاج قرارك» وحده، فإذا قال صاحبُ المقهى عن البند «علمت به» اختفى معه الزرّ
 * وبقي الحسابُ يقول «متوازن على الورق» بلا طريقٍ إلى تسويته (أفال، ١ نوفمبر ٢٠٢٦: «موضوع أفال لم يُحلّ»).
 * فالعملُ يُعرض حيث تُرى المشكلة، لا حيث يمكن إخفاؤها. والقاعدةُ والخادمُ واحد (`unbacked-credit.service.ts`).
 */
export async function SupplierSettleCredit({ supplierId }: { supplierId: string }) {
  const payments = (await loadUnbackedPayments()).filter((p) => p.supplierId === supplierId);
  if (payments.length === 0) return null;
  const evidence = new Map(await Promise.all(payments.map(async (p) => [p.paymentId, await findCreditNoteEvidence(supplierId, p.unbackedMinor)] as const)));
  return (
    <div className="mt-2 space-y-2">
      {payments.map((p) => {
        const found = evidence.get(p.paymentId) ?? null;
        return (
          <div key={p.paymentId} className="flex flex-wrap items-center gap-2">
            {found && (
              <p className="basis-full text-[11px] leading-relaxed text-ok">
                <T s="في كشف المورّد سطرٌ دائن بالمبلغ نفسه: {0}. هذا ما يشرح الخصم." a={[<bdi key="0" dir="ltr">{found.ref ?? formatDay(found.dateIso)}</bdi>]} />
              </p>
            )}
            <SettleFromCredit
              paymentId={p.paymentId}
              amountLabel={`${formatRiyalsDisplay(p.unbackedMinor)} ريال (${formatDay(p.paidOn)})`}
              evidence={found ? { ref: found.ref ?? null, dateIso: found.dateIso } : null}
            />
          </div>
        );
      })}
    </div>
  );
}
