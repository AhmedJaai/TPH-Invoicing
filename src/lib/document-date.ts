/**
 * تاريخُ المستند كما كُتب — إلى `YYYY-MM-DD`، أو `null` إن لم يُفهَم.
 *
 * كان القيدُ يقبل `2026-09-13` حرفاً بحرف، والنموذجُ يعيد ما على الورقة:
 * «13/09/2026» و«2026/09/13» و«١٣-٠٩-٢٠٢٦» و«13/09/2026 15:13». فيُرمى
 * التاريخُ المقروء ولا تُقيَّد الفاتورة، ويقول النظام «لا تاريخ مقيَّد»
 * والتاريخُ مطبوعٌ على الورقة (أحمد، ٢٤ سبتمبر ٢٠٢٦ — «فواتير كثير»).
 *
 * والترتيبُ السعوديّ يومٌ ثمّ شهر. فإن زاد الثاني على ١٢ فهو اليوم
 * (صيغةٌ أمريكيّة)، وإن استحال الاثنان فالتاريخُ مجهول لا مخمَّن.
 * والهجريّ (سنةٌ قبل ١٦٠٠) لا يُحوَّل هنا — يُعلَن مجهولاً.
 */

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

function westernDigits(s: string): string {
  return s.replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // ٣١ فبراير
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function normalizeDocumentDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = westernDigits(raw).trim();

  /* سنةٌ أوّلاً: 2026-09-13 · 2026/9/13 · 2026.09.13 · 2026-09-13T15:13 */
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/);
  if (m) return valid(+m[1], +m[2], +m[3]);

  /* سنةٌ آخراً: 13/09/2026 · 13-9-2026 · 13.09.2026 15:13 */
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:$|[T\s])/);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    if (a > 12 && b <= 12) return valid(y, b, a);
    if (b > 12 && a <= 12) return valid(y, a, b);
    return valid(y, b, a); // يومٌ ثمّ شهر — الترتيبُ السعوديّ
  }
  return null;
}
