/**
 * مرشِّحاتُ سجلّ البنك — المدى بالتاريخ والمبلغ، والتصنيف، والحال — من العنوان.
 *
 * «كم حوّلتُ لفلان بين كذا وكذا؟» كان يُجاب ببحثٍ ثمّ عدٍّ باليد في الصفوف. صار
 * المرشِّحُ في العنوان (`?from=&to=&min=&max=&cat=&state=`) فيُحفَظ الرابطُ ويُرسَل،
 * والخادمُ يحسب مجموعَ ما طابق. دالّةٌ خالصة: ما لا يُفهم يسقط ولا يُخمَّن.
 */
import { HALALAS_PER_RIYAL, parseRiyals } from "../money";
import { isoDay } from "../riyadh-time";
import { CATEGORY_LABEL, isTxCategory, type TxCategory } from "./rules";

/** حالُ الحركة في السجلّ: تنتظر قرارك · طُوبقت بسدادٍ أو قرار · الباقي. */
export const LEDGER_STATES = ["pending", "matched"] as const;
export type LedgerState = (typeof LEDGER_STATES)[number];

export const LEDGER_STATE_LABEL: Record<LedgerState, string> = {
  pending: "تنتظر قرارك",
  matched: "مطابَقة أو مقرَّرة",
};

export interface LedgerFilters {
  /** يومٌ بصيغة `YYYY-MM-DD` شاملاً — أو `null`. */
  fromDay: string | null;
  toDay: string | null;
  /** بالهللات شاملاً — أو `null`. */
  minMinor: number | null;
  maxMinor: number | null;
  category: TxCategory | null;
  state: LedgerState | null;
}

export interface RawLedgerFilters {
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  cat?: string;
  state?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MINOR = 100_000_000_00;

function day(raw: string | undefined): string | null {
  if (!raw || !DAY.test(raw)) return null;
  /* «2026-02-31» يُرفض — لا يصير مارسَ بصمت */
  const d = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === raw ? raw : null;
}

function amount(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  const minor = parseRiyals(raw);
  return minor !== null && minor >= 0 && minor <= MAX_MINOR ? minor : null;
}

export function parseLedgerFilters(raw: RawLedgerFilters): LedgerFilters {
  let fromDay = day(raw.from);
  let toDay = day(raw.to);
  /* من كتب المدى مقلوباً يريد ما بينهما — لا «لا نتائج» */
  if (fromDay && toDay && fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
  let minMinor = amount(raw.min);
  let maxMinor = amount(raw.max);
  if (minMinor !== null && maxMinor !== null && minMinor > maxMinor) [minMinor, maxMinor] = [maxMinor, minMinor];
  const category = raw.cat && isTxCategory(raw.cat) ? raw.cat : null;
  const state = LEDGER_STATES.find((v) => v === raw.state) ?? null;
  return { fromDay, toDay, minMinor, maxMinor, category, state };
}

export function hasLedgerFilters(f: LedgerFilters): boolean {
  return f.fromDay !== null || f.toDay !== null || f.minMinor !== null || f.maxMinor !== null || f.category !== null || f.state !== null;
}

/** المرشِّحُ إلى العنوان — بالأسماء نفسها التي يُقرأ بها، والمبلغُ بالريال كما يُكتب. */
export function ledgerFilterParams(f: LedgerFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.fromDay) out.from = f.fromDay;
  if (f.toDay) out.to = f.toDay;
  if (f.minMinor !== null) out.min = minorToInput(f.minMinor);
  if (f.maxMinor !== null) out.max = minorToInput(f.maxMinor);
  if (f.category) out.cat = f.category;
  if (f.state) out.state = f.state;
  return out;
}

/** المبلغُ في حقل الإدخال — بلا فواصل، والكسرُ إن وُجد. عددٌ صحيح لا عشريّ. */
export function minorToInput(minor: number): string {
  const frac = minor % HALALAS_PER_RIYAL;
  const whole = (minor - frac) / HALALAS_PER_RIYAL;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** الأبوابُ بأسمائها — لقائمة الاختيار، بترتيب الجدول. */
export const CATEGORY_OPTIONS: { value: TxCategory; label: string }[] = Object.keys(CATEGORY_LABEL)
  .filter(isTxCategory)
  .map((value) => ({ value, label: CATEGORY_LABEL[value] }));
