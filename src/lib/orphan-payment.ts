/**
 * دفعةٌ بلا مورّد ولا حركة بنك — طلبُ حسمها يُفحَص وقتَ التشغيل.
 *
 * كان بندُها في «يحتاج قرارك» يقول «راجِعها في سجلّ التدقيق» ولا يعطي
 * فعلاً: ثلاثةُ آلاف ريالٍ قُيّدت من إيصالٍ لم يُقرأ مستفيدُه، تبقى في
 * الطابور أبداً. وحسمُها أحدُ اثنين يعرفهما صاحبُ المقهى من الإيصال:
 *
 *   assign — لمورّدٍ بعينه: تصير رصيداً له يُخصم من دَينه.
 *   void   — ليست سدادَ مورّد (تحويلٌ شخصيّ، أجرة، مصروف): يُلغى قيدُها
 *            بسببه ولا يُحذَف، ويبقى الإيصالُ في الأرشيف.
 */
import { z } from "zod";
import { firstMessage } from "./inventory/count-request";

const id = z.string().trim().min(1).max(64);

export const orphanPaymentRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("assign"), paymentId: id, supplierId: id }).strict(),
  z.object({
    action: z.literal("void"),
    paymentId: id,
    reason: z.string().trim().min(3, "اكتب ما هي هذه الدفعة إن لم تكن لمورّد").max(300),
  }).strict(),
]);

export type OrphanPaymentRequest = z.infer<typeof orphanPaymentRequest>;

export function parseOrphanPaymentRequest(body: unknown):
  | { ok: true; request: OrphanPaymentRequest }
  | { ok: false; error: string } {
  const r = orphanPaymentRequest.safeParse(body);
  if (r.success) return { ok: true, request: r.data };
  return { ok: false, error: firstMessage(r.error) };
}
