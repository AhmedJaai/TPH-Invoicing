/**
 * «سدادٌ بيدٍ مكرّر» — دفعةٌ قُيّدت بيد («سجّل الفاتورة مسدّدة») ولم تعد تسدّد شيئاً،
 * فصارت «رصيداً لك عند المورّد» وهي لم تخرج مرّتين.
 *
 * مود القهوة وجملة التقنية (الإنتاج، ٢٤ أكتوبر ٢٠٢٦): الفاتورةُ نفسها قُيّدت مرّتين،
 * وكلُّ نسخةٍ وُسمت «مسدّدة» من حساب المالك. فلمّا دمجهما أحمد فكّ الدمجُ سدادَ الساقطة
 * فبقي رصيداً (٢٠٤٫٣٠ و٣٨٢٫٠٠) — «مكتوب ان لي مبلغ وهذي مجرد دفعات مكررة».
 *
 * **سدادٌ بيد**: لا حركةَ بنكٍ تشهد له ولا إيصال، وطريقتُه حوالةٌ أو نقدٌ أو من حساب
 * المالك (لا إشعارٌ دائن ولا عهدةُ موظّف)، ولم يُعلَن مقدَّمة. وما شهد له البنكُ أو
 * الإيصالُ مالٌ خرج حقّاً — يبقى رصيداً ولا يُسأل عنه هنا.
 *
 * **ودليلُ التكرار** أحدُ اثنين:
 *   - توأمٌ: للمورّد نفسه دفعةٌ أخرى بالمبلغ نفسه في سبعة أيّام **مخصَّصةٌ على فاتورة**.
 *   - أو أنّ سجلّ التدقيق يقول إنّ دمجَ نسخةٍ مكرّرة أو «حذف القيد» هو الذي فكّها.
 *
 * كشفٌ لا قيد: يُعرض بدليله، والإلغاءُ (`VOID`) بضغطة المالك — أو «هي دفعةٌ حقيقيّة».
 */
import { dayNumber } from "./riyadh-time";
import { SETTLED_TOLERANCE_MINOR } from "./supplier-balances";

/** نافذةُ التوأم — الإقرارُ أُرِّخ بيوم الفاتورة أو يوم الضغط. */
export const HAND_TWIN_WINDOW_DAYS = 7;

/** الطرقُ التي يُقيَّد بها السدادُ بيد — والإشعارُ الدائن والعهدةُ ليسا سداداً يُكرَّر. */
export const HAND_METHODS: ReadonlySet<string> = new Set(["BANK_TRANSFER", "CASH", "OWNER_ACCOUNT"]);

export interface HandPaymentRow {
  id: string;
  supplierId: string;
  /** YYYY-MM-DD */
  day: string;
  amountMinor: number;
  feeMinor: number;
  allocatedMinor: number;
  method: string;
  status: string;
  hasBankRow: boolean;
  hasDocument: boolean;
  isAdvance: boolean;
}

/** ما قاله سجلُّ التدقيق: أيُّ فعلٍ فكّ هذه الدفعة عن فاتورتها. */
export interface ReleaseTrace {
  paymentId: string;
  action: "INVOICE_MERGED" | "INVOICE_ENTRY_REMOVED";
  /** YYYY-MM-DD */
  day: string;
  /** الفاتورةُ التي سقطت أو حُذف قيدُها */
  droppedNumber: string | null;
  /** الباقيةُ في الدمج — `null` في «حذف القيد» */
  keptNumber: string | null;
}

export interface DuplicateHandPayment {
  supplierId: string;
  paymentId: string;
  day: string;
  method: string;
  amountMinor: number;
  /** ما يظهر «رصيداً لك» منها — المبلغُ ناقصَ رسمِه وما خُصّص */
  creditMinor: number;
  /** ما بقي مخصَّصاً منها — يُفكّ بالإلغاء فتعود فاتورتُه مفتوحة */
  allocatedMinor: number;
  twin: { paymentId: string; day: string; bank: boolean } | null;
  release: ReleaseTrace | null;
}

const LIVE = (s: string) => s !== "REVERSED" && s !== "VOID";

/** قُيّد بيد: لا بنكَ يشهد له ولا إيصال، ولم يُعلَن مقدَّمة. */
export function isHandRecorded(p: Pick<HandPaymentRow, "status" | "hasBankRow" | "hasDocument" | "method" | "isAdvance">): boolean {
  return LIVE(p.status) && !p.hasBankRow && !p.hasDocument && !p.isAdvance && HAND_METHODS.has(p.method);
}

/** أقربُ دفعةٍ أخرى للمورّد بالمبلغ نفسه في النافذة، مخصَّصةٍ على فاتورة. */
export function findTwin(p: HandPaymentRow, rows: readonly HandPaymentRow[]): HandPaymentRow | null {
  let best: { r: HandPaymentRow; gap: number } | null = null;
  for (const r of rows) {
    if (r.id === p.id || r.supplierId !== p.supplierId || !LIVE(r.status)) continue;
    if (r.amountMinor !== p.amountMinor || r.allocatedMinor <= 0) continue;
    /* الإشعارُ الدائنُ والعهدةُ ليسا سداداً يقابله */
    if (!r.hasBankRow && !HAND_METHODS.has(r.method)) continue;
    const gap = Math.abs(dayNumber(r.day) - dayNumber(p.day));
    if (gap > HAND_TWIN_WINDOW_DAYS) continue;
    if (!best || gap < best.gap || (gap === best.gap && r.id < best.r.id)) best = { r, gap };
  }
  return best?.r ?? null;
}

/**
 * كلُّ سدادٍ بيدٍ قائمٍ يظهر رصيداً وله دليلُ تكرار — الأحدثُ أوّلاً في كلّ مورّد.
 * `releases` من سجلّ التدقيق (`INVOICE_MERGED` · `INVOICE_ENTRY_REMOVED`)، الأحدثُ لكلّ دفعة.
 */
export function findDuplicateHandPayments(
  rows: readonly HandPaymentRow[],
  releases: ReadonlyMap<string, ReleaseTrace> = new Map(),
): DuplicateHandPayment[] {
  const out: DuplicateHandPayment[] = [];
  for (const p of rows) {
    if (!isHandRecorded(p)) continue;
    const credit = p.amountMinor - p.feeMinor - p.allocatedMinor;
    if (credit <= SETTLED_TOLERANCE_MINOR) continue;
    const twin = findTwin(p, rows);
    const release = releases.get(p.id) ?? null;
    if (!twin && !release) continue;
    out.push({
      supplierId: p.supplierId,
      paymentId: p.id,
      day: p.day,
      method: p.method,
      amountMinor: p.amountMinor,
      creditMinor: credit,
      allocatedMinor: p.allocatedMinor,
      twin: twin ? { paymentId: twin.id, day: twin.day, bank: twin.hasBankRow } : null,
      release,
    });
  }
  return out.sort((a, b) => a.supplierId.localeCompare(b.supplierId) || b.day.localeCompare(a.day) || a.paymentId.localeCompare(b.paymentId));
}

/** مفتاحُ «هي دفعةٌ حقيقيّة» في `alert_resolutions` — بصيغة 078 (`بادئة:معرّف`). */
export function handDuplicateKey(paymentId: string): string {
  return `hand-dup:${paymentId}`;
}

/**
 * عند الدمج أو «حذف القيد»: أهذه الدفعةُ سدادٌ بيدٍ لم يسدّد إلّا هذه الفاتورة، بمبلغها كلّه؟
 * فإن فُكّت عنها لم يبقَ لها ما تسدّده — وإبقاؤها «رصيداً» هو ما صنع رصيد مود القهوة.
 * ودفعةٌ سدّدت فاتورةً أخرى معها، أو زاد منها شيء، لا تُلغى من هنا: لها شأنٌ غيرُ هذا.
 */
export function onlyPaidThis(
  p: Pick<HandPaymentRow, "status" | "hasBankRow" | "hasDocument" | "method" | "isAdvance" | "amountMinor" | "feeMinor">,
  allocations: readonly { invoiceId: string; amountMinor: number }[],
  invoiceId: string,
): boolean {
  if (!isHandRecorded(p) || allocations.length === 0) return false;
  if (allocations.some((a) => a.invoiceId !== invoiceId)) return false;
  return allocations.reduce((s, a) => s + a.amountMinor, 0) === p.amountMinor - p.feeMinor;
}

/** لماذا يُظنّ مكرّراً — جملةٌ واحدة للشاشة وللسجلّ. */
export function duplicateWhy(
  d: Pick<DuplicateHandPayment, "twin" | "release">,
  twinInvoices: readonly string[] = [],
): string {
  const parts: string[] = [];
  if (d.release?.action === "INVOICE_MERGED") {
    const { droppedNumber: dropped, keptNumber: kept } = d.release;
    parts.push(dropped && kept && dropped !== kept
      ? `كانت سداد ${dropped}، وهي نسخة مكررة دُمجت في ${kept} المسدّدة`
      : kept
        ? `كانت سداد نسخة مكررة من ${kept} دُمجت في أختها المسدّدة`
        : "كانت سداد نسخة مكررة من فاتورة دُمجت في أختها المسدّدة");
  } else if (d.release?.action === "INVOICE_ENTRY_REMOVED") {
    parts.push(d.release.droppedNumber ? `كانت سداد ${d.release.droppedNumber}، وقد حُذف قيدها` : "كانت سداد فاتورة حُذف قيدها");
  }
  if (d.twin) {
    const verb = d.twin.bank ? "سدّدت" : "سدّد";
    parts.push(`وللمورّد ${d.twin.bank ? "حوالة في كشف البنك" : "سداد آخر مسجّل"} بالمبلغ نفسه`
      + (twinInvoices.length > 0 ? ` ${verb} ${twinInvoices.join("، ")}` : ` ${verb} فاتورته`));
  }
  const text = parts.join("، ");
  return text.startsWith("و") ? text.slice(1) : text;
}
