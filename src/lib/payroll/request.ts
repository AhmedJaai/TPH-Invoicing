/**
 * حقولُ طلبات الموظّفين — تُفحص وقتَ التشغيل، والمالُ نصٌّ يُقرأ هللاتٍ في الخادم.
 */
import { z } from "zod";
import { parseRiyals } from "@/lib/money";

export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "اكتب الشهر بصيغة YYYY-MM");
export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "اكتب التاريخ بصيغة YYYY-MM-DD");
export const Id = z.string().trim().min(1).max(64);
/** المبلغُ نصّاً بالريال. */
export const Amount = z.string().trim().min(1, "اكتب المبلغ").max(20);
export const Note = z.string().trim().max(300).optional().transform((v) => (v ? v : null));

/** هللاتٌ موجبة، أو رسالةٌ تقول لماذا. */
export function positiveMinor(text: string): { ok: true; minor: number } | { ok: false; error: string } {
  const minor = parseRiyals(text);
  if (minor === null) return { ok: false, error: "المبلغ غير مفهوم. اكتبه أرقاماً، مثل 3500 أو 3500.50" };
  if (minor <= 0) return { ok: false, error: "المبلغ يجب أن يكون أكبر من صفر." };
  return { ok: true, minor };
}
