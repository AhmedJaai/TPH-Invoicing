/**
 * كم من فواتير المورّد الضريبيّة حمل رمزَ QR يُقرأ — من أدلّة القراءة المحفوظة.
 *
 * كلُّ قراءةٍ تحفظ ما وجدته في الرمز (`extraction_cache.evidence.qr`). فيُعَدّ للمورّد:
 * كم فاتورةً برمزٍ صالح، وكم بلا رمز، وكم برمزٍ لا يُفهم. **وما قُرئ قبل أن تُحفظ
 * الأدلّة «لم يُفحص»** — لا «بلا رمز»: الغائبُ عن علمٍ غيرُ الغائب عن جهل.
 *
 * عدٌّ لا حكم: هل يلزم المورّدَ رمزٌ (المرحلة الثانية من الفوترة الإلكترونيّة) سؤالٌ
 * عن المورّد لا يجيب عنه هذا الملفّ.
 */

/** حالُ الرمز كما حُفظت — `null` القراءةُ بلا دليلٍ محفوظ. */
export type StoredQrStatus = "FOUND" | "NOT_ZATCA" | "NONE" | "SKIPPED" | null;

export interface QrCoverage {
  invoices: number;
  /** برمزٍ ضريبيّ قُرئ. */
  withQr: number;
  /** منها ما يحمل توقيعَ المرحلة الثانية. */
  phase2: number;
  /** فُحصت ولا رمزَ فيها. */
  withoutQr: number;
  /** فيها رمزٌ ليس رمزَ الهيئة. */
  foreignQr: number;
  /** لم تُفحص: قُرئت قبل حفظ الأدلّة، أو تُخطّي فحصُها. */
  unchecked: number;
}

export function isStoredQrStatus(v: unknown): v is Exclude<StoredQrStatus, null> {
  return v === "FOUND" || v === "NOT_ZATCA" || v === "NONE" || v === "SKIPPED";
}

export function qrCoverage(rows: readonly { status: StoredQrStatus; phase2: boolean }[]): QrCoverage {
  const out: QrCoverage = { invoices: rows.length, withQr: 0, phase2: 0, withoutQr: 0, foreignQr: 0, unchecked: 0 };
  for (const r of rows) {
    if (r.status === "FOUND") { out.withQr++; if (r.phase2) out.phase2++; }
    else if (r.status === "NONE") out.withoutQr++;
    else if (r.status === "NOT_ZATCA") out.foreignQr++;
    else out.unchecked++;
  }
  return out;
}

/** كم فاتورةً فُحصت فعلاً — مقامُ «N من M برمز». */
export function checkedCount(c: QrCoverage): number {
  return c.withQr + c.withoutQr + c.foreignQr;
}
