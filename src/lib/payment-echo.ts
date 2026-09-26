/**
 * الدفعةُ التي قُيِّدت مرّتين: حوالةٌ في الكشف، وإقرارٌ باليد عن الحوالة نفسها.
 *
 * وُجدت في كوهي وأطلس (٢٦ سبتمبر ٢٠٢٦): حوالةُ الكشف قُيِّدت دفعةً ولم
 * تُنسب إلى فاتورة، ثمّ «وُسمت الفاتورة مسدَّدة» باليد فأُنشئت دفعةٌ ثانية
 * بلا حركة بنك وخُصّصت عليها. فالحسابُ يقول «متّزن»: فاتورةٌ مفتوحة
 * يقابلها «رصيدٌ لك» هو الحوالةُ نفسها — والحقُّ أنّ الفاتورة الأحدث لم
 * تُسدَّد. والتوأمةُ عند الإنشاء (`findPaymentTwin`) تطابق اليوم، والإقرارُ
 * أُرِّخ بيوم الفاتورة، ففاتته.
 *
 * **الصدى** إقرارٌ باليد «حوالةً» (لا من حساب المالك ولا نقداً)، بلا حركة
 * بنك ولا إيصال، يقابله للمورّد نفسه وبالمبلغ نفسه حوالةٌ من الكشف لم
 * يُخصَّص منها ما يسعه، في نافذة أيّام. فالإقرارُ قال «خرجت حوالة» والكشفُ
 * يُريها — ولا حوالةَ ثانية فيه.
 *
 * كشفٌ لا قيد: يُعرض بدليله، والدمجُ بإقرار الإنسان (`account-review.service.ts`).
 */

/** نافذةُ الأيّام بين الإقرار وحوالته — الإقرارُ أُرِّخ بيوم الفاتورة أو يوم الضغط. */
export const ECHO_WINDOW_DAYS = 14;

export interface EchoPayment {
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
}

export interface PaymentEcho {
  supplierId: string;
  /** الإقرارُ باليد — يُلغى (`VOID`) وتنتقل تخصيصاتُه. */
  manualId: string;
  /** الحوالةُ من الكشف — تأخذ تخصيصاتِه. */
  bankId: string;
  amountMinor: number;
  manualDay: string;
  bankDay: string;
  daysApart: number;
}

const LIVE = (s: string) => s !== "REVERSED" && s !== "VOID";

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
}

/**
 * يقرن كلَّ إقرارٍ بأقرب حوالةٍ تسعه — وكلُّ حوالةٍ لإقرارٍ واحد.
 * الأقربُ يوماً أوّلاً، فحوالتان متساويتان لمورّدٍ يدفع المبلغ نفسه كلّ
 * أسبوع (كوهي) لا تُنسب إحداهما لإقرارٍ هو للأخرى.
 */
export function findPaymentEchoes(rows: readonly EchoPayment[]): PaymentEcho[] {
  const manuals = rows.filter((p) =>
    LIVE(p.status) && !p.hasBankRow && !p.hasDocument && p.method === "BANK_TRANSFER" && p.allocatedMinor > 0);
  const banks = rows.filter((p) => LIVE(p.status) && p.hasBankRow);

  const pairs: { m: EchoPayment; b: EchoPayment; gap: number }[] = [];
  for (const m of manuals) {
    for (const b of banks) {
      if (b.supplierId !== m.supplierId || b.amountMinor !== m.amountMinor) continue;
      /* ما بقي في الحوالة يسع ما خُصّص على الإقرار */
      const free = b.amountMinor - b.feeMinor - b.allocatedMinor;
      if (free < m.allocatedMinor) continue;
      const gap = Math.abs(dayNumber(m.day) - dayNumber(b.day));
      if (gap > ECHO_WINDOW_DAYS) continue;
      pairs.push({ m, b, gap });
    }
  }
  pairs.sort((x, y) => x.gap - y.gap || x.m.day.localeCompare(y.m.day));

  const usedM = new Set<string>();
  const usedB = new Set<string>();
  const out: PaymentEcho[] = [];
  for (const { m, b, gap } of pairs) {
    if (usedM.has(m.id) || usedB.has(b.id)) continue;
    usedM.add(m.id);
    usedB.add(b.id);
    out.push({
      supplierId: m.supplierId,
      manualId: m.id,
      bankId: b.id,
      amountMinor: m.amountMinor,
      manualDay: m.day,
      bankDay: b.day,
      daysApart: gap,
    });
  }
  return out.sort((a, b) => a.supplierId.localeCompare(b.supplierId) || a.bankDay.localeCompare(b.bankDay));
}

/** مفتاحُ الزوج — يُعاد اشتقاقُه في الخادم، فلا يُصدَّق المتصفّح في أنّهما زوج. */
export function echoKey(e: Pick<PaymentEcho, "manualId" | "bankId">): string {
  return `${e.manualId}:${e.bankId}`;
}

/* ─────────────── الصدى على رصيد: الحوالةُ أكبرُ من الإقرار ─────────────── */

/** كم يوماً قبل الإقرار تُعدّ حوالةُ الكشف غيرُ المنسوبة مصدرَه — كما في `drawBankCredit`. */
export const CREDIT_ECHO_LOOKBACK_DAYS = 60;

export interface CreditEcho {
  supplierId: string;
  manualId: string;
  manualDay: string;
  /** ما خصّصه الإقرارُ على فواتيره — ينتقل إلى الحوالات. */
  amountMinor: number;
  /** الحوالاتُ التي يُؤخذ منها، بأقربها يوماً. */
  sources: { bankId: string; day: string; amountMinor: number }[];
}

/**
 * الإقرارُ الذي لم يقابله صدى بالمبلغ نفسه، وللمورّد نفسه حوالاتٌ في الكشف
 * لم تُنسب تسعه — من ٦٠ يوماً قبله إلى ثلاثةٍ بعده. غاناش: حوالاتٌ جامعة
 * بـ٢٦ ألفاً «رصيداً لك»، وفاتورتان بـ٤٥٥٫٤٠ وُسمتا «سُدّدت» بيد.
 * ويُستهلك رصيدُ كلّ حوالةٍ مرّةً واحدة بين الإقرارات، الأقدمُ إقراراً أوّلاً.
 */
export function findCreditEchoes(rows: readonly EchoPayment[], taken: readonly string[] = []): CreditEcho[] {
  const skip = new Set(taken);
  const manuals = rows
    .filter((p) => LIVE(p.status) && !p.hasBankRow && !p.hasDocument && p.method === "BANK_TRANSFER"
      && p.allocatedMinor > 0 && !skip.has(p.id))
    .sort((a, b) => a.day.localeCompare(b.day));
  const free = new Map(rows
    .filter((p) => LIVE(p.status) && p.hasBankRow && !skip.has(p.id))
    .map((p) => [p.id, p.amountMinor - p.feeMinor - p.allocatedMinor] as const)
    .filter(([, v]) => v > 0));
  const banks = rows.filter((p) => free.has(p.id));

  const out: CreditEcho[] = [];
  for (const m of manuals) {
    const pool = banks
      .filter((b) => b.supplierId === m.supplierId)
      .map((b) => ({ b, gap: dayNumber(m.day) - dayNumber(b.day) }))
      .filter(({ gap }) => gap <= CREDIT_ECHO_LOOKBACK_DAYS && gap >= -3)
      .sort((x, y) => Math.abs(x.gap) - Math.abs(y.gap));
    const available = pool.reduce((s, { b }) => s + (free.get(b.id) ?? 0), 0);
    if (available < m.allocatedMinor) continue;

    let need = m.allocatedMinor;
    const sources: CreditEcho["sources"] = [];
    for (const { b } of pool) {
      if (need <= 0) break;
      const take = Math.min(free.get(b.id) ?? 0, need);
      if (take <= 0) continue;
      free.set(b.id, (free.get(b.id) ?? 0) - take);
      sources.push({ bankId: b.id, day: b.day, amountMinor: take });
      need -= take;
    }
    out.push({ supplierId: m.supplierId, manualId: m.id, manualDay: m.day, amountMinor: m.allocatedMinor, sources });
  }
  return out;
}
