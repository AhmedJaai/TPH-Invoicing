/**
 * قراءة ما يخصّ كشف الحساب من مخرَج النموذج الخام: أسطره ورصيداه.
 *
 * كان مسار الأرشفة يأخذ الرصيد الختاميّ وحده ويرمي الباقي — فبقيت
 * `statement_lines` فارغةً في كل كشفٍ أُرشف، ثمّ قيل في بوّابة الإنتاج
 * «أحد عشر كشفاً ولم يُطابَق منها واحد» كأنّ التقصير من المستخدم.
 *
 * ويُقرأ من `rawExtraction` — ما قاله النموذج قبل أي تعديل — لا من حقلٍ
 * يرسله المتصفّح، على قاعدة `reviewConfirmed()`: الخادم يشتقّ الرقم
 * المالي بنفسه.
 *
 * والمجهول يبقى مجهولاً: سطرٌ بلا تاريخٍ صالح يسقط ولا يُعطى تاريخ اليوم،
 * ورصيدٌ لم يُقرأ يُرجَع `null` لا صفراً.
 */
import { parseRiyals } from "@/lib/money";
import type { RawStatementLine } from "@/services/invoice.service";

export interface StatementExtras {
  openingBalanceMinor: number | null;
  closingBalanceMinor: number | null;
  lines: RawStatementLine[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** تاريخٌ صالح أو `null` — ولا يُستبدَل المجهول بـ«اليوم». */
function parseDay(v: unknown): Date | null {
  const s = asText(v);
  if (!ISO_DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseStatementExtras(raw: unknown): StatementExtras {
  const rec = asRecord(raw);
  if (!rec) return { openingBalanceMinor: null, closingBalanceMinor: null, lines: [] };

  const rawLines = Array.isArray(rec.statementLines) ? rec.statementLines : [];
  const lines: RawStatementLine[] = [];

  for (const item of rawLines) {
    const l = asRecord(item);
    if (!l) continue;

    const date = parseDay(l.date);
    if (!date) continue; // سطرٌ بلا تاريخ لا يُقيَّد — التاريخ هو ما يُطابَق به

    const debitMinor = parseRiyals(asText(l.debit)) ?? 0;
    const creditMinor = parseRiyals(asText(l.credit)) ?? 0;
    if (debitMinor === 0 && creditMinor === 0) continue; // سطرُ رصيدٍ أو ترويسة

    lines.push({
      date,
      ref: asText(l.ref) || null,
      description: asText(l.description) || null,
      debitMinor: Math.abs(debitMinor),
      creditMinor: Math.abs(creditMinor),
    });
  }

  return {
    openingBalanceMinor: parseRiyals(asText(rec.openingBalance)),
    closingBalanceMinor: parseRiyals(asText(rec.closingBalance)),
    lines,
  };
}
