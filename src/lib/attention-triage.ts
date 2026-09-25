import { AREA_LABEL, type AttentionArea, type AttentionItem, type AttentionSeverity, type ImpactKind } from "./attention";

/**
 * عرضُ «يحتاج قرارك» — تصفيةٌ وتجميعٌ وخلاصة، بلا قاعدةٍ ماليّة جديدة.
 *
 * البنودُ نفسُها من `attentionItems()` وترتيبُها من `prioritize()`؛ وهنا
 * ما تحتاجه الشاشة لتعرضها: أيُّها «إشارة» (مالٌ جرى على غير المعتاد)،
 * وأيُّ باقةٍ مختارة في العنوان، وما المعلَّقُ بها بحسب نوع أثره.
 */

/** كلُّ معرِّفٍ يُنتجه `buildAttention` — والاختبار يطابقها بالملفّ، فلا يضيع بندٌ جديد بلا رمز. */
export const ATTENTION_IDS = [
  "bank-coverage-gap",
  "bank-stale",
  "bank-balance-difference",
  "duplicate-expenses",
  "duplicate-payments",
  "duplicate-payments-claimed",
  "unbacked-payments",
  "open-blockers",
  "vat-at-risk",
  "overdue",
  "unclassified-bank",
  "price-rises",
  "lifecycle-anomalies",
  "bounced-payments",
  "missing-statements",
  "unknown-tax",
  "no-lines",
  "pending-documents",
  "no-contract",
] as const;

export type AttentionId = (typeof ATTENTION_IDS)[number];

export function isKnownId(id: string): id is AttentionId {
  return (ATTENTION_IDS as readonly string[]).includes(id);
}

/**
 * «إشاراتٌ في المال» — ما يقول إنّ مالاً جرى على غير ما ينبغي: خرج مرّتين،
 * أو بلا مستند، أو عاد، أو ارتفع سعرُه، أو غاب كشفُه فلا يُعرَف ما جرى.
 * وما عداها أعمالٌ ترتيبيّة: مستندٌ يُعتمَد، وكشفٌ يُطلَب، وسياسةٌ تُعلَن.
 */
export const SIGNAL_IDS: ReadonlySet<AttentionId> = new Set<AttentionId>([
  "bank-coverage-gap",
  "bank-stale",
  "bank-balance-difference",
  "duplicate-expenses",
  "duplicate-payments",
  "duplicate-payments-claimed",
  "unbacked-payments",
  "price-rises",
  "lifecycle-anomalies",
  "bounced-payments",
]);

export function isSignal(item: Pick<AttentionItem, "id">): boolean {
  return isKnownId(item.id) && SIGNAL_IDS.has(item.id);
}

/** البنودُ التي يُحسَم عملُها داخل الطابور — لها لوحُ فعلٍ في الصفحة. */
export const IN_PLACE_IDS: ReadonlySet<AttentionId> = new Set<AttentionId>([
  "duplicate-payments",
  "duplicate-payments-claimed",
  "unclassified-bank",
  "unbacked-payments",
  "pending-documents",
  "open-blockers",
  "no-contract",
  "missing-statements",
]);

export function resolvesInPlace(item: Pick<AttentionItem, "id">): boolean {
  return isKnownId(item.id) && IN_PLACE_IDS.has(item.id);
}

/* ─────────────────────────── العدسة (?in=) ─────────────────────────── */

export type Lens = "all" | "signals" | AttentionArea;

const AREAS: AttentionArea[] = ["BANK", "PAYMENTS", "SUPPLIERS", "VAT", "INVOICES", "DATA"];

function isArea(raw: string): raw is AttentionArea {
  return Object.hasOwn(AREA_LABEL, raw);
}

/** ما في العنوان يُقرأ ولا يُصدَّق: قيمةٌ غير معروفة تعني «الكلّ». */
export function parseLens(raw: string | undefined): Lens {
  if (raw === "signals") return "signals";
  if (raw && isArea(raw)) return raw;
  return "all";
}

export function inLens(item: AttentionItem, lens: Lens): boolean {
  if (lens === "all") return true;
  if (lens === "signals") return isSignal(item);
  return item.area === lens;
}

/** رابطُ بندٍ في عدسته — `?item=` وحده يبقى صالحاً لروابط الرئيسية والإشعارات. */
export function itemHref(id: string, lens: Lens = "all"): string {
  const q = new URLSearchParams();
  if (lens !== "all") q.set("in", lens);
  q.set("item", id);
  return `/attention?${q.toString()}`;
}

export function lensHref(lens: Lens): string {
  return lens === "all" ? "/attention" : `/attention?in=${lens}`;
}

/** الألسنة: الكلّ، ثمّ الإشارات، ثمّ الأبوابُ التي فيها شيءٌ الآن — بعددها. */
export function lensTabs(items: readonly AttentionItem[]): { lens: Lens; label: string; count: number }[] {
  const tabs: { lens: Lens; label: string; count: number }[] = [
    { lens: "all", label: "الكلّ", count: items.length },
  ];
  const signals = items.filter(isSignal).length;
  if (signals > 0) tabs.push({ lens: "signals", label: "إشاراتٌ في المال", count: signals });
  for (const area of AREAS) {
    const n = items.filter((i) => i.area === area).length;
    if (n > 0) tabs.push({ lens: area, label: AREA_LABEL[area], count: n });
  }
  return tabs;
}

/* ─────────────────────────── التجميع والتنقّل ─────────────────────────── */

const SEVERITY_ORDER: AttentionSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "OPPORTUNITY"];

/** مجموعاتٌ بالشدّة — والترتيبُ داخلها ترتيبُ `prioritize()` كما وصل. */
export function groupBySeverity(
  items: readonly AttentionItem[],
): { severity: AttentionSeverity; items: AttentionItem[] }[] {
  return SEVERITY_ORDER
    .map((severity) => ({ severity, items: items.filter((i) => i.severity === severity) }))
    .filter((g) => g.items.length > 0);
}

/** موضعُ البند في القائمة كما تُرى (بعد التجميع)، وجاراه — للتنقّل من التفصيل. */
export function neighbours(
  items: readonly AttentionItem[],
  id: string,
): { index: number; prev: AttentionItem | null; next: AttentionItem | null } {
  const flat = groupBySeverity(items).flatMap((g) => g.items);
  const index = flat.findIndex((i) => i.id === id);
  if (index === -1) return { index: -1, prev: null, next: null };
  return { index, prev: flat[index - 1] ?? null, next: flat[index + 1] ?? null };
}

/* ─────────────────────────── المالُ المعلَّق ─────────────────────────── */

/** ترتيبُ الأنواع في الخلاصة: ما يُستردّ ثمّ ما يضيع ثمّ ما عليك، ثمّ ما لم يُنسب والتقديرُ والمانع. */
const STAKE_ORDER: ImpactKind[] = ["RECOVERABLE", "AT_RISK", "OWED", "UNATTRIBUTED", "ANNUAL", "BLOCKED"];

export interface Stake {
  kind: ImpactKind;
  /** مجموعُ ما عُرف قدرُه وحده. */
  knownMinor: number;
  /** كم بنداً من هذا النوع. */
  items: number;
  /** كم منها أثرُه معلومٌ وقدرُه مجهول — لا يُجمع صفراً. */
  unknown: number;
}

/**
 * المعلَّقُ بحسب نوعه — ولا يُجمع نوعٌ إلى نوع (ريالٌ قد يُسترد ليس كريالٍ
 * معرَّضٍ للضياع). والمجهولُ يُعَدّ ولا يُجمع: فإن كان كلُّ النوع مجهولاً
 * قيل «غير معروف»، وإن كان بعضُه قيل ما عُرف ومعه أنّ غيره لم يُقدَّر.
 */
export function stakeByKind(items: readonly AttentionItem[]): Stake[] {
  const by = new Map<ImpactKind, Stake>();
  for (const i of items) {
    const s = by.get(i.impact.kind) ?? { kind: i.impact.kind, knownMinor: 0, items: 0, unknown: 0 };
    s.items++;
    if (i.impact.amountMinor === null) s.unknown++;
    else s.knownMinor += i.impact.amountMinor;
    by.set(i.impact.kind, s);
  }
  return STAKE_ORDER.flatMap((k) => {
    const s = by.get(k);
    return s ? [s] : [];
  });
}
