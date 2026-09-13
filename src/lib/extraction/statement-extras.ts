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
  /**
   * أسطرٌ فيها مبلغٌ لم يُقرأ أو تاريخٌ لم يُقرأ — تُعلَن ولا تُسقَط.
   * كان «1,2O0.00» يصير صفراً فيُحذف السطر، فتظهر فاتورته «عندنا ولم ترد
   * في كشفه» والمجهول صار نفياً.
   */
  unreadLines: { date: string; description: string; amountText: string }[];
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
  if (!rec) return { openingBalanceMinor: null, closingBalanceMinor: null, lines: [], unreadLines: [] };

  const rawLines = Array.isArray(rec.statementLines) ? rec.statementLines : [];
  const lines: RawStatementLine[] = [];
  const unreadLines: StatementExtras["unreadLines"] = [];

  for (const item of rawLines) {
    const l = asRecord(item);
    if (!l) continue;

    const debitText = asText(l.debit);
    const creditText = asText(l.credit);
    const debitRead = debitText ? parseRiyals(debitText) : 0;
    const creditRead = creditText ? parseRiyals(creditText) : 0;
    const unread = () => unreadLines.push({
      date: asText(l.date), description: asText(l.description), amountText: debitText || creditText,
    });

    if (debitRead === null || creditRead === null) { unread(); continue; }
    const debitMinor = debitRead;
    const creditMinor = creditRead;
    if (debitMinor === 0 && creditMinor === 0) continue; // سطرُ رصيدٍ أو ترويسة

    const date = parseDay(l.date);
    // سطرٌ بلا تاريخ لا يُقيَّد — التاريخ هو ما يُطابَق به — ويُعلَن
    if (!date) { unread(); continue; }

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
    unreadLines,
  };
}
