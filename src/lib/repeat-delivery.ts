/**
 * توريدٌ واحد قُيِّد مرّتين — فاتورةٌ ألغاها المورّد وأصدر بديلتها برقمٍ آخر، وبقيتا معاً.
 *
 * أفال (١٢ أكتوبر ٢٠٢٦): INV-2026-00080 (١٣ أغسطس) أُلغيت لخطأٍ في سعر بند وصدرت مكانها
 * 00084 (١٥ أغسطس) بالبنود والكمّيّات نفسها. الرقمان مختلفان فلا يراهما كاشفُ النُّسخ، وكشفُ
 * المورّد حملهما معاً فدُفعتا كلتاهما — ‏١٬٩٩٨٫٧٠ لم يرها أحدٌ شهرين. والعلامةُ كانت في البنود:
 * الأصنافُ نفسُها بالكمّيّات نفسِها بعد يومين، عند مورّدٍ يورّد كلَّ أسبوع.
 *
 * فالقاعدة: للمورّد نفسِه، فاتورتان بينهما `REPEAT_WINDOW_DAYS` فأقلّ، بنودُهما واحدة صنفاً
 * وكمّيّة — وإيقاعُ المورّد أبطأ من ذلك (`USUAL_GAP_MIN_DAYS`): من يورّد كلَّ يومٍ الطلبَ نفسَه
 * لا يُسأل عنه. وهي **سؤالٌ لا حكم**: قد يكونان توريدَين حقيقيَّين، ويُغلق بـ«توريدان فعلاً».
 */
export const REPEAT_WINDOW_DAYS = 3;
/** وسيطُ ما بين فواتير المورّد — دونه التكرارُ عادتُه لا استثناؤه. */
export const USUAL_GAP_MIN_DAYS = 5;
/** أقلُّ ما يُعرف به إيقاعُ مورّد. */
const RHYTHM_MIN_INVOICES = 4;

export interface DeliveryLine {
  /** صنفُ الجرد إن رُبط، وإلّا الوصفُ المطبَّع. */
  key: string;
  /** `null` = لم تُقرأ الكمّيّة — فلا تُقارَن الفاتورة. */
  qtyMilli: number | null;
}

export interface DeliveryInvoice {
  id: string;
  supplierId: string;
  number: string;
  /** YYYY-MM-DD */
  day: string;
  totalMinor: number;
  lines: readonly DeliveryLine[];
}

export interface RepeatPair {
  supplierId: string;
  first: DeliveryInvoice;
  second: DeliveryInvoice;
  gapDays: number;
  /** ما يُسترَدّ إن كانا توريداً واحداً — أصغرُ الإجماليَّين. */
  atStakeMinor: number;
}

const dayNumber = (day: string): number => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** بصمةُ البنود: الصنفُ وكمّيّتُه مجموعةً — وترتيبُ السطور وتقسيمُها لا يغيّرانها. */
export function deliverySignature(lines: readonly DeliveryLine[]): string | null {
  if (lines.length === 0) return null;
  const byKey = new Map<string, number>();
  for (const l of lines) {
    if (l.qtyMilli === null || l.qtyMilli <= 0) return null;
    byKey.set(l.key, (byKey.get(l.key) ?? 0) + l.qtyMilli);
  }
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, q]) => `${k}=${q}`).join("|");
}

/** وسيطُ الأيّام بين أيّام فواتير المورّد المتتالية — `null` إن لم تكفِ لمعرفة إيقاعه. */
export function usualGapDays(days: readonly string[]): number | null {
  const distinct = [...new Set(days)].map(dayNumber).sort((a, b) => a - b);
  if (distinct.length < RHYTHM_MIN_INVOICES) return null;
  const gaps = distinct.slice(1).map((d, i) => d - distinct[i]).sort((a, b) => a - b);
  return gaps[Math.floor((gaps.length - 1) / 2)];
}

export function findRepeatDeliveries(invoices: readonly DeliveryInvoice[]): RepeatPair[] {
  const bySupplier = new Map<string, DeliveryInvoice[]>();
  for (const i of invoices) bySupplier.set(i.supplierId, [...(bySupplier.get(i.supplierId) ?? []), i]);

  const out: RepeatPair[] = [];
  for (const [supplierId, list] of bySupplier) {
    const usual = usualGapDays(list.map((i) => i.day));
    if (usual !== null && usual < USUAL_GAP_MIN_DAYS) continue;
    const sorted = [...list].sort((a, b) => dayNumber(a.day) - dayNumber(b.day) || (a.number < b.number ? -1 : 1));
    const signed = sorted.map((i) => ({ invoice: i, signature: deliverySignature(i.lines) }));
    for (let a = 0; a < signed.length; a++) {
      if (signed[a].signature === null) continue;
      for (let b = a + 1; b < signed.length; b++) {
        const gapDays = dayNumber(signed[b].invoice.day) - dayNumber(signed[a].invoice.day);
        if (gapDays > REPEAT_WINDOW_DAYS) break;
        if (signed[b].signature !== signed[a].signature) continue;
        out.push({
          supplierId, first: signed[a].invoice, second: signed[b].invoice, gapDays,
          atStakeMinor: Math.min(signed[a].invoice.totalMinor, signed[b].invoice.totalMinor),
        });
      }
    }
  }
  return out;
}
