/**
 * حارسُ تغيّر الآيبان — حوالةٌ لمورّدٍ ذهبت إلى حسابٍ غير حسابه المعروف.
 *
 * «غيّرنا حسابنا البنكيّ» أشيعُ احتيالٍ على المنشآت الصغيرة: رسالةٌ باسم المورّد
 * وآيبانٌ جديد. والكشفُ يحمل آيبانَ المستفيد في نصّ كلّ حوالة، وملفُّ المورّد يحمل
 * الآيبانَ الذي كتبه صاحبُه بيده — فالمخالفةُ تُحسب ولا تُخمَّن.
 *
 * **تنبيهٌ لا منع** (قاعدة ٧ أكتوبر): الحوالةُ خرجت أصلاً، وقد يكون للمورّد حسابان.
 * يُعرض الآيبانان والمبلغ، ويُغلق بضغطةٍ بسببها — ويعود السؤالُ إن ظهر حسابٌ ثالث،
 * لأنّ مفتاحَ القرار المورّدُ والآيبانُ معاً لا المورّدُ وحده.
 *
 * وما لا آيبانَ في نصّه **مجهول** لا مخالف: لا يُقال فيه شيء.
 */
import { extractReferences } from "./canonical";

export interface GuardSupplier {
  id: string;
  /** الآيبانُ المكتوب بيد في ملفّ المورّد — `null` لم يُكتب. */
  savedIban: string | null;
  /** يومُ كتابته `YYYY-MM-DD` — ما حُوِّل قبله تاريخٌ لا مخالفة. `null` غير معروف. */
  savedOn: string | null;
}

export interface GuardTransfer {
  id: string;
  supplierId: string;
  /** `YYYY-MM-DD` */
  day: string;
  amountMinor: number;
  /** نصُّ الحركة كما في الكشف (الوصف والمستفيد). */
  text: string;
}

export type IbanAlertKind =
  /** يخالف ما كتبه صاحبُ المقهى في ملفّ المورّد. */
  | "DIFFERS_FROM_SAVED"
  /** لا آيبانَ مكتوباً، وحوالاتُه السابقة كلُّها إلى حسابٍ آخر. */
  | "NEW_ACCOUNT";

export interface IbanAlert {
  supplierId: string;
  kind: IbanAlertKind;
  /** الآيبانُ الذي ذهبت إليه الحوالة. */
  seenIban: string;
  /** الحسابُ المعروف قبلها: المكتوبُ بيد، أو ما حُوِّل له من قبل. */
  knownIbans: string[];
  /** الحوالاتُ التي ذهبت إلى الحساب المخالف — الأقدمُ أوّلاً. */
  transfers: { id: string; day: string; amountMinor: number }[];
  totalMinor: number;
}

/** كم حوالةً سابقة إلى حسابٍ واحد تجعله «حسابَه المعروف» حين لا آيبانَ مكتوباً. */
export const MIN_ESTABLISHED_TRANSFERS = 2;

export function ibanAlertKey(supplierId: string, iban: string): string {
  return `iban:${supplierId}:${iban}`;
}

/** آيباناتُ المستفيد في نصّ الحركة — بلا حسابات المقهى نفسِه. */
export function payeeIbans(text: string, ownIbans: ReadonlySet<string>): string[] {
  return extractReferences(text)
    .filter((r) => r.kind === "IBAN" && !ownIbans.has(r.value))
    .map((r) => r.value);
}

/**
 * @param sinceDay لا يُنبَّه إلّا على ما وقع في هذا اليوم وما بعده — ما قبله يُقرأ
 *   تاريخاً يُبنى عليه «الحسابُ المعروف» ولا يُسأل عنه اليوم.
 */
export function findIbanAlerts(
  suppliers: readonly GuardSupplier[],
  transfers: readonly GuardTransfer[],
  ownIbans: ReadonlySet<string>,
  sinceDay: string,
): IbanAlert[] {
  const supplierOf = new Map(suppliers.map((s) => [s.id, s]));
  const bySupplier = new Map<string, GuardTransfer[]>();
  for (const t of transfers) {
    if (!supplierOf.has(t.supplierId)) continue;
    const list = bySupplier.get(t.supplierId) ?? [];
    list.push(t);
    bySupplier.set(t.supplierId, list);
  }

  const out: IbanAlert[] = [];
  for (const [supplierId, list] of bySupplier) {
    const supplier = supplierOf.get(supplierId);
    if (!supplier) continue;
    const ordered = [...list].sort((a, b) => (a.day === b.day ? a.id.localeCompare(b.id) : a.day.localeCompare(b.day)));
    /* كم حوالةً ذهبت إلى كلّ آيبانٍ حتى الآن — يُبنى والحوالاتُ تُقرأ بترتيبها */
    const seenCount = new Map<string, number>();
    const alerts = new Map<string, IbanAlert>();

    for (const t of ordered) {
      const ibans = payeeIbans(t.text, ownIbans);
      for (const iban of ibans) {
        let kind: IbanAlertKind | null = null;
        let known: string[] = [];
        if (supplier.savedIban) {
          /* ما حُوِّل قبل أن يُكتب الآيبان تاريخ: الحسابُ القديم قبل أن يُحدَّث الملفّ */
          const afterSaved = supplier.savedOn === null || t.day >= supplier.savedOn;
          if (iban !== supplier.savedIban && afterSaved) {
            kind = "DIFFERS_FROM_SAVED";
            known = [supplier.savedIban];
          }
        } else if (!seenCount.has(iban)) {
          const established = [...seenCount].filter(([, n]) => n >= MIN_ESTABLISHED_TRANSFERS).map(([v]) => v);
          if (established.length > 0) {
            kind = "NEW_ACCOUNT";
            known = established;
          }
        }
        /* حسابٌ فُتح عليه سؤالٌ تلحق به حوالاتُه التالية — سؤالٌ واحد لا سؤالٌ لكلّ حوالة */
        const open = alerts.get(iban);
        if (open) {
          open.transfers.push({ id: t.id, day: t.day, amountMinor: t.amountMinor });
          open.totalMinor += t.amountMinor;
        } else if (kind && t.day >= sinceDay) {
          alerts.set(iban, {
            supplierId,
            kind,
            seenIban: iban,
            knownIbans: known,
            transfers: [{ id: t.id, day: t.day, amountMinor: t.amountMinor }],
            totalMinor: t.amountMinor,
          });
        }
      }
      for (const iban of ibans) seenCount.set(iban, (seenCount.get(iban) ?? 0) + 1);
    }
    out.push(...alerts.values());
  }
  /* الأحدثُ أوّلاً: آخرُ حوالةٍ هي التي قد تُستردّ */
  return out.sort((a, b) => lastDay(b).localeCompare(lastDay(a)) || b.totalMinor - a.totalMinor);
}

function lastDay(a: IbanAlert): string {
  return a.transfers[a.transfers.length - 1]?.day ?? "";
}

/** الآيبانُ أربعاً أربعاً — يُقرأ ويُقابَل بما في تطبيق البنك. */
export function groupIban(iban: string): string {
  return iban.replace(/(.{4})(?=.)/g, "$1 ");
}

/* ───────────────────── أوّلُ حوالةٍ إلى حسابٍ جديد ───────────────────── */

/** دون هذا المبلغ لا يُذكر — خمسمئة ريال. */
export const FIRST_TRANSFER_MIN_MINOR = 500_00;

export interface LedgerTransfer {
  id: string;
  /** `YYYY-MM-DD` */
  day: string;
  amountMinor: number;
  text: string;
  /** لمن خرجت كما يعرفها النظام (مورّدٌ أو مستفيدُ الكشف) — `null` غير معروف. */
  payee: string | null;
}

export interface FirstTransfer {
  iban: string;
  payee: string | null;
  transfers: { id: string; day: string; amountMinor: number }[];
  totalMinor: number;
}

export function firstTransferKey(iban: string): string {
  return `iban-first:${iban}`;
}

/**
 * صادرٌ إلى آيبانٍ لم يُرَ قطّ قبل `sinceDay`، ومجموعُ ما خرج إليه منذئذٍ بلغ الحدّ.
 * **للعلم لا للمنع**: حين يكون للحساب مفوَّضٌ ثانٍ، يرى صاحبُه كلَّ مستفيدٍ جديد مرّة.
 */
export function findFirstTransfers(
  transfers: readonly LedgerTransfer[],
  ownIbans: ReadonlySet<string>,
  sinceDay: string,
  minMinor: number = FIRST_TRANSFER_MIN_MINOR,
): FirstTransfer[] {
  const seenBefore = new Set<string>();
  const fresh = new Map<string, FirstTransfer>();
  const ordered = [...transfers].sort((a, b) => (a.day === b.day ? a.id.localeCompare(b.id) : a.day.localeCompare(b.day)));
  for (const t of ordered) {
    for (const iban of payeeIbans(t.text, ownIbans)) {
      if (t.day < sinceDay) { seenBefore.add(iban); continue; }
      if (seenBefore.has(iban)) continue;
      const f = fresh.get(iban) ?? { iban, payee: t.payee, transfers: [], totalMinor: 0 };
      f.transfers.push({ id: t.id, day: t.day, amountMinor: t.amountMinor });
      f.totalMinor += t.amountMinor;
      f.payee = f.payee ?? t.payee;
      fresh.set(iban, f);
    }
  }
  return [...fresh.values()]
    .filter((f) => f.totalMinor >= minMinor)
    .sort((a, b) => b.totalMinor - a.totalMinor || a.iban.localeCompare(b.iban));
}

/** آيبانٌ يظهر في حوالات هذا العدد من المورّدين فأكثر ليس حسابَ أحدهم. */
export const SHARED_IBAN_SUPPLIERS = 3;

/**
 * آيباناتٌ مشتركة بين مورّدين كثُر — حسابُ المقهى نفسُه مطبوعاً في كلّ حوالة، أو حسابُ
 * وسيط. الدليلُ القاطع لا يدلّ على جهتين (`evidence-uniqueness.ts`)، فما اشتُرك سقط:
 * لا يُسأل به عن مورّد. يحمي حين لا يكون آيبانُ حساب المقهى مكتوباً في إعداداته.
 */
export function sharedIbans(transfers: readonly GuardTransfer[], minSuppliers: number = SHARED_IBAN_SUPPLIERS): Set<string> {
  const suppliersOf = new Map<string, Set<string>>();
  for (const t of transfers) {
    for (const iban of payeeIbans(t.text, new Set())) {
      const set = suppliersOf.get(iban) ?? new Set<string>();
      set.add(t.supplierId);
      suppliersOf.set(iban, set);
    }
  }
  return new Set([...suppliersOf].filter(([, s]) => s.size >= minSuppliers).map(([iban]) => iban));
}
