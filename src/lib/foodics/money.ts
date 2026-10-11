/**
 * أرقامُ فودكس إلى أعدادنا الصحيحة — بلا حسابٍ عائم.
 *
 * الواجهةُ تُرجع الريالَ عدداً بكسور (`16.52174`). فيُقرأ **نصُّه** خانةً خانة
 * (`readSalesAmount`) كما يُقرأ ملفُّ الإكسل، لا بضربه في مئة: `1.005 × 100`
 * عائمةً ‎100.4999‎. وما لا يُقرأ `null` — «غير معروف» لا صفر.
 */
import { decimalToMilli } from "@/lib/inventory/units";
import { microToMinor, readSalesAmount } from "@/lib/sales/values";

/** جزءٌ من مئة ألفٍ من الريال — للجمع قبل التقريب. `null` لما غاب أو لم يُقرأ. */
export function riyalsToMicro(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  /* `toFixed` لا يكتب الصيغة الأسّيّة، وستُّ منازل فوق دقّة فودكس (خمس) */
  const read = readSalesAmount(value.toFixed(6));
  return read.state === "OK" ? read.micro : null;
}

/** الريال إلى هللات، والنصفُ بعيداً عن الصفر. */
export function riyalsToMinor(value: number | null | undefined): number | null {
  const micro = riyalsToMicro(value);
  return micro === null ? null : microToMinor(micro);
}

/** الكمّيّة بالمِلّي — `0.33` كرتون ← ‎330‎. */
export function quantityToMilli(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return decimalToMilli(value.toFixed(6));
}

/** `2026-10-09 23:42:25` (توقيتٌ عالميّ عند فودكس) ← لحظة. و`null` لما لا يُقرأ. */
export function parseFoodicsMoment(text: string | null | undefined): Date | null {
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  return Number.isNaN(at.getTime()) ? null : at;
}
