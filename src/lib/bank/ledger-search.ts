/**
 * بحثُ سجلّ البنك — ما كتبه الباحثُ يُفهَم مبلغاً أو نصّاً، ويُسأل به الخادم.
 *
 * كان البحثُ يصفّي أحدثَ الصفوف المرسومة وحدها، فحوالةٌ قديمة لا تُوجَد إلّا
 * بتخمين شهرها. صار `?q=` يبحث في الحركات كلِّها: المبلغُ بالهللات (بتسامح ريالٍ
 * حين يُكتب بلا كسر) والنصُّ في وصف البنك واسم المستفيد. دالّةٌ خالصة.
 */
import { HALALAS_PER_RIYAL, parseRiyals } from "../money";

export interface LedgerSearch {
  /** النصُّ كما يُبحث به — مقصوصٌ ومحدودُ الطول. */
  text: string;
  /** نمطُ `ILIKE` بمحارفه الخاصّة مهرَّبة. */
  like: string;
  /** إن قُرئ مبلغاً: المدى بالهللات (شاملاً الطرفين). */
  amount: { fromMinor: number; toMinor: number } | null;
}

const MAX_CHARS = 80;

export function parseLedgerSearch(raw: string | undefined | null): LedgerSearch | null {
  const text = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_CHARS);
  if (text.length < 2) return null;
  const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  let amount: LedgerSearch["amount"] = null;
  /* رقمٌ خالص (بفواصله وكسره) يُقرأ مبلغاً — ورقمُ مرجعٍ طويل يبقى نصّاً */
  if (/^[\d٠-٩۰-۹.,٫٬\s]+$/.test(text)) {
    const minor = parseRiyals(text);
    if (minor !== null && minor > 0 && minor <= 100_000_000_00) {
      /* «2450» بلا كسر تجد 2450.00 حتى 2450.99؛ و«2450.50» تجد نفسَها وحدها */
      const whole = !/[.٫]\d/.test(text);
      amount = { fromMinor: minor, toMinor: whole ? minor + HALALAS_PER_RIYAL - 1 : minor };
    }
  }
  return { text, like, amount };
}
