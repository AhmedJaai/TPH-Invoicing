/**
 * طلبُ الكمّيّة المستلَمة — يُفحَص وقتَ التشغيل كطلب الجرد.
 *
 * الكمّيّةُ أوّلاً وهي وحدها المشترطة مع الصنف والتاريخ؛ والمورّدُ
 * والمستندُ والكلفةُ اختياريّة. والكلفةُ نصٌّ بالريال يُحوَّل إلى هللاتٍ
 * بقراءةٍ عشريّة — **ولا تُشتقّ منها كمّيّة**.
 */
import { z } from "zod";
import { decimalToMilli } from "./units";
import { firstMessage, isoDate, storedUnit } from "./count-request";

const id = z.string().trim().min(1).max(64);

const quantity = z.string().max(24).transform((v, ctx) => {
  const milli = decimalToMilli(v.trim());
  if (milli === null || milli <= 0) {
    ctx.addIssue({ code: "custom", message: `كمّيّةٌ غير مقروءة: «${v}» — الاستلامُ كمّيّةٌ موجبة` });
    return z.NEVER;
  }
  return milli;
});

/** ريالاتٌ نصّاً ← هللات. والفراغُ «لا كلفةَ معروفة». */
const riyals = z.union([z.string().max(24), z.null()]).transform((v, ctx) => {
  if (v === null || v.trim() === "") return null;
  const milli = decimalToMilli(v.trim().replace(/,/g, ""));
  if (milli === null || milli < 0 || milli % 10 !== 0) {
    ctx.addIssue({ code: "custom", message: `مبلغٌ غير مقروء: «${v}» — ريالٌ وهللتان على الأكثر` });
    return z.NEVER;
  }
  /* مِلّي‑ريال ÷ ١٠ = هللة — بلا عائمة */
  return milli / 10;
});

const resolution = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("LINK"), invoiceLineId: id }).strict(),
  z.object({ kind: z.literal("SEPARATE") }).strict(),
]);

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const receiptRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    productId: id,
    branchId: id.nullish(),
    receivedOn: isoDate,
    quantity,
    unit: storedUnit,
    supplierId: id.nullish(),
    documentRef: text(120),
    cost: riyals.optional(),
    note: text(500),
    resolution: resolution.nullish(),
  }).strict(),
  z.object({
    action: z.literal("update"),
    receiptId: id,
    receivedOn: isoDate.optional(),
    quantity: quantity.optional(),
    unit: storedUnit.optional(),
    supplierId: id.nullish(),
    documentRef: text(120),
    cost: riyals.optional(),
    note: text(500),
  }).strict(),
  z.object({
    action: z.literal("void"),
    receiptId: id,
    reason: z.string().trim().min(3, "اكتب سببَ الإلغاء").max(500),
  }).strict(),
  z.object({
    action: z.literal("resolve"),
    receiptId: id,
    resolution,
  }).strict(),
]);

export type ReceiptRequest = z.infer<typeof receiptRequest>;

export function parseReceiptRequest(body: unknown):
  | { ok: true; request: ReceiptRequest }
  | { ok: false; error: string } {
  const r = receiptRequest.safeParse(body);
  if (r.success) return { ok: true, request: r.data };
  return { ok: false, error: firstMessage(r.error) };
}
