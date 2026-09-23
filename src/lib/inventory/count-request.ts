/**
 * طلبُ الجرد يُفحَص وقتَ التشغيل — لا بـ`as Body`.
 *
 * `as` تُسكت المترجم ولا تفحص شيئاً: طلبٌ فيه `entries: "abc"` أو
 * `countId: 7` كان يمرّ إلى الخدمة ويسقط في منتصفها — أو لا يسقط
 * ويكتب ما لا يُقصَد. وقد كتب هذا المستودع الدرسَ من قبل: **`as`
 * تُسكت المترجم ولا تُصلح اختلافاً**.
 *
 * فالطلبُ اتّحادٌ مميَّزٌ على `action`، ولكلّ فعلٍ شكلُه، و`.strict()`
 * يردّ الحقلَ الزائد — فالحقلُ الذي لا يُقرأ يُرسَل ظنّاً أنّه يُقرأ.
 *
 * ── والكمّيّةُ نصٌّ لا عدد ──
 *
 * «5.2» تُقرأ خاناتٍ عشريّة إلى مِلّي بلا فاصلةٍ عائمة (`decimalToMilli`).
 * والعددُ JSON يمرّ بالعائمة قبل أن يصل: ‏`0.1 + 0.2` مثلاً. فيُردّ.
 *
 * ووحدةٌ مستقلّة عن المسار كي تُختبَر بلا خادمٍ ولا جلسة.
 */
import { z } from "zod";
import { decimalToMilli } from "./units";
import { STORED_UNITS, type StoredUnit } from "@/lib/unit-conversion";

const MAX_ITEMS = 2000;

const id = z.string().trim().min(1, "معرّفٌ فارغ").max(64, "معرّفٌ أطول من المعقول");

/** تاريخٌ حقيقيّ بصيغة `YYYY-MM-DD` — لا «2026-02-30». */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD").refine((v) => {
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}, "تاريخٌ غير موجود في التقويم");

export const storedUnit = z.enum(STORED_UNITS as unknown as [StoredUnit, ...StoredUnit[]], {
  error: "وحدةٌ غير معروفة",
});

/**
 * كمّيّةٌ نصّاً ← مِلّي من وحدتها. والفراغُ `null` («لم يُعَدّ» /
 * «أفرِغه»)، والسالبُ وما لا يُقرأ يُردّ.
 */
export const quantityText = z
  .union([z.string().max(24, "كمّيّةٌ أطول من المعقول"), z.null()])
  .transform((v, ctx) => {
    if (v === null || v.trim() === "") return null;
    const milli = decimalToMilli(v.trim());
    if (milli === null || milli < 0) {
      ctx.addIssue({ code: "custom", message: `كمّيّةٌ غير مقروءة: «${v}» — اكتب رقماً موجباً` });
      return z.NEVER;
    }
    return milli;
  });

const entry = z.object({
  productId: id,
  actual: quantityText,
  unit: storedUnit,
}).strict();

const openingEntry = z.object({
  productId: id,
  quantity: quantityText,
  unit: storedUnit,
  note: z.string().trim().max(500).nullish(),
}).strict();

export const countRequest = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    periodStart: isoDate,
    periodEnd: isoDate,
    branchId: id.nullish(),
    note: z.string().trim().max(500).nullish(),
  }).strict(),
  z.object({
    action: z.literal("scope"),
    countId: id,
    /* المجموعتان في طلبٍ واحد — فلا يبقى النطاقُ نصفَ مكتوب */
    included: z.array(id).max(MAX_ITEMS),
    excluded: z.array(id).max(MAX_ITEMS),
  }).strict(),
  z.object({
    action: z.literal("save"),
    countId: id,
    entries: z.array(entry).min(1, "لا صنفَ في الطلب").max(MAX_ITEMS),
  }).strict(),
  z.object({
    action: z.literal("opening"),
    countId: id,
    entries: z.array(openingEntry).min(1, "لا صنفَ في الطلب").max(MAX_ITEMS),
  }).strict(),
  z.object({ action: z.literal("finalise"), countId: id }).strict(),
  z.object({
    action: z.literal("reopen"),
    countId: id,
    reason: z.string().trim().min(5, "اكتب سببَ إعادة الفتح — خمسةُ أحرفٍ على الأقلّ").max(500),
  }).strict(),
  z.object({ action: z.literal("recompute"), countId: id }).strict(),
]);

export type CountRequest = z.infer<typeof countRequest>;

/** يُحلّل الطلب — ويُرجع رسالةً تُقرأ لا شجرةَ أخطاء. */
export function parseCountRequest(body: unknown):
  | { ok: true; request: CountRequest }
  | { ok: false; error: string } {
  const r = countRequest.safeParse(body);
  if (r.success) return { ok: true, request: r.data };
  return { ok: false, error: firstMessage(r.error) };
}

export function firstMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "طلبٌ غير مفهوم";
  if (issue.code === "invalid_union" || issue.path[0] === "action") return "فعلٌ غير معروف";
  if (issue.code === "unrecognized_keys") return `حقلٌ غير متوقَّع: ${issue.keys.join("، ")}`;
  if (issue.code === "invalid_type") return `حقلٌ مفقودٌ أو من نوعٍ خاطئ: ${issue.path.join(".") || "الطلب"}`;
  return issue.message;
}
