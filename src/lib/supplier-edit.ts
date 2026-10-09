/**
 * بياناتُ المورّد التي يكتبها الإنسان — فحصُها وتطبيعُها، دوالَّ خالصة.
 *
 * كانت الراياتُ الخمس (`supplier-policy`) وحدها ما يُعدَّل بعد الإنشاء: الاسمُ
 * والرقمُ الضريبيّ والسجلّ والتصنيف لا تُصحَّح من الواجهة، وشروطُ السداد نصٌّ
 * لا يقرؤه شيء، ولا هاتفَ ولا آيبان. وهنا القواعدُ التي يمرّ بها التعديل:
 *
 *   • الآيبانُ السعوديّ ٢٤ خانة يثبته mod-97 (ISO 13616) — خانةٌ خاطئة في
 *     التحويل مالٌ يذهب إلى غير صاحبه، وهذا خطأٌ حسابيّ قاطع يُردّ.
 *   • الهاتفُ يُحفظ E.164 ليُفتح به واتساب.
 *   • أجلُ السداد أيّامٌ صحيحة؛ والفراغ «غير معروف» لا صفر.
 */
import { z } from "zod";
import { latinDigits } from "./invoice-number";
import { isValidSaudiVat } from "./validation";
import { parseRiyals } from "./money";

/** الآيبانُ بلا فراغاتٍ وبحروفٍ كبيرة وأرقامٍ لاتينيّة. */
export function normalizeIban(raw: string): string {
  return latinDigits(raw).replace(/[\s\-]/g, "").toUpperCase();
}

/** mod-97 على نصٍّ طويل بلا أعدادٍ كبيرة: خانةً خانة. */
function mod97(digits: string): number {
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rest;
}

/** آيبانٌ سعوديّ صحيح: `SA` + ٢٢ رقماً، وخانتا التحقّق تثبتان بـmod-97. */
export function isValidSaudiIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^SA\d{22}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  const numeric = [...rearranged].map((c) => (/\d/.test(c) ? c : String(c.charCodeAt(0) - 55))).join("");
  return mod97(numeric) === 1;
}

/**
 * الهاتفُ بصيغة E.164 — «0551234567» و«966551234567» و«+966 55 123 4567» واحد.
 * وما لا يُفهم `null` — لا يُخمَّن رقمٌ يُرسَل إليه.
 */
export function normalizePhoneE164(raw: string): string | null {
  const d = latinDigits(raw).replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(d)) return d;
  if (/^00\d{8,15}$/.test(d)) return `+${d.slice(2)}`;
  if (/^05\d{8}$/.test(d)) return `+966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `+966${d}`;
  if (/^9665\d{8}$/.test(d)) return `+${d}`;
  return null;
}

/** رابطُ واتساب: على رقم المورّد إن عُرف، وإلّا شاشةُ اختيار الجهة كما كان. */
export function whatsappHref(phoneE164: string | null | undefined, text: string): string {
  const to = phoneE164 ? phoneE164.replace(/\D/g, "") : "";
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/**
 * يومُ استحقاق الفاتورة = يومُها + أجلُ المورّد. `null` إن جُهل الأجل — لا
 * يُفترض أجلٌ فيُقال «متأخّر» عن مورّدٍ أمهلنا.
 */
export function dueDay(invoiceDay: string, termsDays: number | null | undefined): string | null {
  if (termsDays === null || termsDays === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDay)) return null;
  const [y, m, d] = invoiceDay.split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + termsDays));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${due.getUTCFullYear()}-${pad(due.getUTCMonth() + 1)}-${pad(due.getUTCDate())}`;
}

/** كم يوماً فات على استحقاقها (موجبٌ = متأخّرة)، أو `null` إن جُهل الأجل. */
export function daysPastDue(invoiceDay: string, termsDays: number | null | undefined, today: string): number | null {
  const due = dueDay(invoiceDay, termsDays);
  if (!due) return null;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
}

export const SUPPLIER_CATEGORIES = ["COFFEE", "FOOD", "PACKAGING", "EQUIPMENT", "WATER", "UTILITIES", "OTHER"] as const;
export const SUPPLIER_CATEGORY_LABEL: Record<(typeof SUPPLIER_CATEGORIES)[number], string> = {
  COFFEE: "قهوة", FOOD: "أغذية", PACKAGING: "تعبئة وتغليف", EQUIPMENT: "معدّات",
  WATER: "مياه", UTILITIES: "مرافق", OTHER: "أخرى",
};

/*
  الحقلُ الغائب «لا تغيّره»، والنصُّ الفارغ «امحُه» (يصير غير معروف). فالطلبُ
  الجزئيّ لا يمحو ما لم يُذكَر — كما في `supplier-policy`.
*/
const text = (max: number) => z.string().trim().max(max);

export const supplierProfileRequest = z.object({
  supplierId: z.string().trim().min(1).max(64),
  nameAr: text(200).min(2, "اسمُ المورّد حرفان على الأقلّ").optional(),
  nameEn: text(200).optional(),
  vatNumber: text(30).optional()
    .refine((v) => !v || isValidSaudiVat(v), "الرقم الضريبيّ 15 رقماً يبدأ بـ3 وينتهي بـ3 — صحّحه أو اتركه فارغاً"),
  crNumber: text(30).optional(),
  category: z.enum(SUPPLIER_CATEGORIES).optional(),
  /** أيّامٌ صحيحة نصّاً — والفارغ «غير معروف». */
  paymentTermsDays: text(4).optional()
    .refine((v) => !v || (/^\d{1,3}$/.test(latinDigits(v)) && Number(latinDigits(v)) <= 365), "أجلُ السداد أيّامٌ من 0 إلى 365 — أو اتركه فارغاً"),
  /** حدُّ الرصيد بالريال نصّاً — والفارغ «بلا حدّ». */
  balanceAlert: text(20).optional()
    .refine((v) => { if (!v) return true; const m = parseRiyals(v); return m !== null && m > 0; }, "حدُّ التنبيه مبلغٌ بالريال أكبر من صفر — أو اتركه فارغاً"),
  phone: text(30).optional()
    .refine((v) => !v || normalizePhoneE164(v) !== null, "رقمُ الجوّال لا يُفهم — اكتبه 05xxxxxxxx أو بمفتاح الدولة"),
  email: text(120).optional()
    .refine((v) => !v || z.email().safeParse(v).success, "البريدُ الإلكترونيّ لا يُفهم"),
  contactName: text(120).optional(),
  iban: text(40).optional()
    .refine((v) => !v || isValidSaudiIban(v), "الآيبانُ لا يستقيم: SA ثمّ 22 رقماً، وخانتا التحقّق لا تطابقان — راجِعه خانةً خانة"),
  /** «نعم، غيّر الرقم الضريبيّ/الآيبان رغم التنبيه» — بعد ردّ 409 `warnings`. */
  confirm: z.boolean().optional(),
}).strict();

export type SupplierProfileRequest = z.infer<typeof supplierProfileRequest>;

/** فاتورةٌ مفتوحة بيومها — ما يكفي لسؤال «أجاوزت أجلَها؟». */
export interface OpenInvoiceDay {
  date: string;
  openMinor: number;
}

/**
 * ما جاوز أجلَه من المفتوح — بأجل المورّد نفسه لا بستّين يوماً للجميع.
 * `null` إن جُهل الأجل: لا يُقال «متأخّر» ولا «في أجله» عن غير علم.
 */
export function pastDueOf(
  open: readonly OpenInvoiceDay[],
  termsDays: number | null | undefined,
  today: string,
): { count: number; totalMinor: number; oldestDays: number } | null {
  if (termsDays === null || termsDays === undefined) return null;
  let count = 0;
  let totalMinor = 0;
  let oldestDays = 0;
  for (const i of open) {
    const late = daysPastDue(i.date, termsDays, today);
    if (late === null || late <= 0) continue;
    count++;
    totalMinor += i.openMinor;
    oldestDays = Math.max(oldestDays, late);
  }
  return { count, totalMinor, oldestDays };
}
