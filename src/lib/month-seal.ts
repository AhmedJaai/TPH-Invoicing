/**
 * أرقامُ الشهر المختومة عند إقفاله، وما تغيّر منها بعده — دالّةٌ خالصة.
 *
 * الإقفالُ شهادةٌ بأنّ الشهر تمّ. والشهادةُ بلا أرقامها لا تُقارَن بشيء: فاتورةٌ متأخّرة
 * تُقيَّد في شهرٍ قبله، أو اختيارٌ ضريبيّ (لا يقفله الإقفال عمداً)، أو حركةٌ يُعاد تصنيفها،
 * تحرّك «عليك» أو الضريبة في شهرٍ قيل إنّه تمّ — ولا يعلم أحد. فيُكتب لحظةَ الإقفال
 * (`month-seal.service.ts`) ما تقوله الشاشاتُ نفسُها، ويُقارَن كلَّ صباح.
 *
 * **ولا يُختم الربح هنا**: قائمةُ الدخل تُجمَّد عند الإقفال في `finance_snapshots`
 * (`freezePnl`)، و`loadPnl` يقول «تغيّر الحسابُ الحيّ» لشهرها بنفسه. وإعادةُ حسابها
 * لكلّ شهرٍ مقفلٍ كلَّ صباح تقرأ أسطرَ المبيعات كلَّها — ثقيلةٌ بلا فائدةٍ زائدة.
 */
import { z } from "zod";
import { formatRiyalsDisplay } from "./money";

export const SEAL_VERSION = 1;

/** ما لا يُختم، وسببه — يُكتب في الختم نفسه كي لا يُظنّ مختوماً. */
export const NOT_SEALED: readonly string[] = [
  "الربح: مجمَّدٌ عند الإقفال في تقرير المالية، وصفحتها تقول إن تغيّر حسابُه",
];

const Minor = z.number().int();

const SealedFiguresSchema = z.object({
  v: z.literal(SEAL_VERSION),
  owed: z.object({
    totalMinor: Minor,
    suppliers: z.array(z.object({ id: z.string(), name: z.string(), owedMinor: Minor })),
  }),
  bank: z.array(z.object({
    accountId: z.string().nullable(),
    label: z.string(),
    /** الرصيدُ الختاميّ كما في كشف البنك — `null` لم يُعرف (لا صفر). */
    closingMinor: Minor.nullable(),
    creditsMinor: Minor,
    debitsMinor: Minor,
  })),
  vat: z.object({ outputVatMinor: Minor, inputVatMinor: Minor, netMinor: Minor }),
  notSealed: z.array(z.string()),
});

export type SealedFigures = z.infer<typeof SealedFiguresSchema>;

/** ختمٌ من القاعدة — وما لا يُقرأ بهذا الشكل (نسخةٌ أخرى) `null`: لا يُقارَن، ولا يُخترَع له فرق. */
export function readSealedFigures(raw: unknown): SealedFigures | null {
  const parsed = SealedFiguresSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface FigureDrift {
  month: string;
  /** اسمُ الرقم كما يُقال لصاحبه — «عليك للمورّدين في آخر الشهر»، «ضريبة المخرجات». */
  figure: string;
  sealedMinor: number | null;
  nowMinor: number | null;
}

const BANK_NONE = "∅";

/**
 * ما اختلف بين الختم والحساب الآن. المورّدُ الغائب من أحد الطرفين «عليك له» صفرٌ محسوب
 * (لا مجهول): الحسابُ جرى ولم يبقَ له شيء. والرصيدُ الختاميّ المجهول يبقى مجهولاً، فإن
 * عُرف بعد الإقفال أو جُهل فذلك فرقٌ يُقال.
 */
export function diffSealedFigures(month: string, sealed: SealedFigures, now: SealedFigures): FigureDrift[] {
  const out: FigureDrift[] = [];
  const push = (figure: string, a: number | null, b: number | null) => {
    if (a !== b) out.push({ month, figure, sealedMinor: a, nowMinor: b });
  };

  push("عليك للمورّدين في آخر الشهر", sealed.owed.totalMinor, now.owed.totalMinor);
  const sealedOwed = new Map(sealed.owed.suppliers.map((s) => [s.id, s]));
  const nowOwed = new Map(now.owed.suppliers.map((s) => [s.id, s]));
  for (const id of new Set([...sealedOwed.keys(), ...nowOwed.keys()])) {
    const name = nowOwed.get(id)?.name ?? sealedOwed.get(id)?.name ?? "مورّد";
    push(`عليك لـ«${name}» في آخر الشهر`, sealedOwed.get(id)?.owedMinor ?? 0, nowOwed.get(id)?.owedMinor ?? 0);
  }

  const key = (b: { accountId: string | null }) => b.accountId ?? BANK_NONE;
  const sealedBank = new Map(sealed.bank.map((b) => [key(b), b]));
  const nowBank = new Map(now.bank.map((b) => [key(b), b]));
  for (const k of new Set([...sealedBank.keys(), ...nowBank.keys()])) {
    const a = sealedBank.get(k);
    const b = nowBank.get(k);
    const label = b?.label ?? a?.label ?? "حساب غير معروف";
    push(`رصيد ختام ${label}`, a?.closingMinor ?? null, b?.closingMinor ?? null);
    push(`الوارد إلى ${label}`, a?.creditsMinor ?? 0, b?.creditsMinor ?? 0);
    push(`الصادر من ${label}`, a?.debitsMinor ?? 0, b?.debitsMinor ?? 0);
  }

  push("ضريبة المخرجات", sealed.vat.outputVatMinor, now.vat.outputVatMinor);
  push("ضريبة المدخلات", sealed.vat.inputVatMinor, now.vat.inputVatMinor);
  return out;
}

/** «عند الإقفال ١٬٢٠٠٫٠٠ · الآن ١٬٣٥٠٫٠٠» — والمجهولُ «غير معروف». */
export function driftLine(d: Pick<FigureDrift, "sealedMinor" | "nowMinor">): string {
  const fmt = (m: number | null) => (m === null ? "غير معروف" : formatRiyalsDisplay(m));
  return `عند الإقفال ${fmt(d.sealedMinor)} · الآن ${fmt(d.nowMinor)}`;
}

/** مقدارُ التغيّر كلِّه بالهللات — بصمةُ البند: إن تغيّر عاد البندُ بعد «علمت». والمجهولُ لا يُعدّ. */
export function driftMagnitude(findings: readonly Pick<FigureDrift, "sealedMinor" | "nowMinor">[]): number {
  return findings.reduce((s, d) => s + (d.sealedMinor === null || d.nowMinor === null ? 1 : Math.abs(d.nowMinor - d.sealedMinor)), 0);
}

/** ما يحفظه فحصُ الصباح — صفٌّ في `daily_checks`. */
const DriftCheckSchema = z.object({
  months: z.number().int(),
  findings: z.array(z.object({
    sealId: z.string(),
    month: z.string(),
    figure: z.string(),
    sealedMinor: Minor.nullable(),
    nowMinor: Minor.nullable(),
  })),
});

export type DriftCheck = z.infer<typeof DriftCheckSchema>;

export function readDriftCheck(raw: unknown): DriftCheck | null {
  const parsed = DriftCheckSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
