/**
 * حارسُ تغيّر الآيبان — الوقائعُ من القاعدة، والحكمُ في `lib/bank/iban-guard.ts`.
 *
 * يقرأ صادرَ البنك المنسوبَ لمورّد (بالحركة أو بدفعتها) الذي يحمل آيباناً في نصّه،
 * ويقابله بالآيبان المكتوب في ملفّ المورّد أو بما حُوِّل له من قبل. والقرارُ
 * («أعرفه — حسابٌ له») صفٌّ في `alert_resolutions` بمفتاحٍ يُشتقّ من المورّد
 * والآيبان، فيُسحَب بحذفه ويعود السؤال.
 */
import { eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { alertResolutions, bankAccounts, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  findFirstTransfers, findIbanAlerts, firstTransferKey, ibanAlertKey, sharedIbans, type FirstTransfer, type IbanAlert,
} from "@/lib/bank/iban-guard";
import { normalizeIban } from "@/lib/supplier-edit";
import { todayInRiyadh, isoDay } from "@/lib/riyadh-time";
import type { Conn, Tx } from "./types";

/** لا يُسأل اليومَ عن حوالةٍ أقدم من هذا — ما قبله يبني «الحسابَ المعروف» وحده. */
export const IBAN_ALERT_WINDOW_DAYS = 120;

export interface IbanAlertRow extends IbanAlert {
  supplierName: string;
  supplierSlug: string;
  key: string;
  /** قرارُ الإنسان إن وُجد: متى وبأيّ ملاحظة. */
  decision: { at: Date; note: string | null } | null;
}

function windowStart(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - IBAN_ALERT_WINDOW_DAYS);
  return isoDay(d);
}

/** كلُّ ما يراه الحارس: المفتوحُ وما أُغلق بقرار — والشاشةُ تفرز. */
export async function loadIbanAlerts(reader: Conn = db): Promise<IbanAlertRow[]> {
  const [transfers, own, decided] = await Promise.all([
    reader.execute<{
      id: string; supplier_id: string; day: string; amount_minor: number; text: string;
    }>(sql`
      select bt.id,
             coalesce(bt.supplier_id, p.supplier_id) as supplier_id,
             to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             bt.amount_minor,
             coalesce(bt.description, '') || ' ' || coalesce(bt.beneficiary_raw, '') as text
        from bank_transactions bt
        left join payments p on p.id = bt.matched_payment_id
       where bt.direction = 'DEBIT'
         and coalesce(bt.supplier_id, p.supplier_id) is not null
         and (bt.description ~* 'SA[0-9]{22}' or bt.beneficiary_raw ~* 'SA[0-9]{22}')
    `),
    reader.select({ iban: bankAccounts.iban }).from(bankAccounts),
    reader.select().from(alertResolutions).where(like(alertResolutions.key, "iban:%")),
  ]);
  if (transfers.rows.length === 0) return [];

  const supplierRows = await reader
    .select({
      id: suppliers.id, name: suppliers.nameAr, slug: suppliers.slug,
      iban: suppliers.iban, ibanSetAt: suppliers.ibanSetAt,
    })
    .from(suppliers);
  const info = new Map(supplierRows.map((s) => [s.id, s]));

  const guardTransfers = transfers.rows.map((r) => ({
    id: r.id, supplierId: r.supplier_id, day: r.day, amountMinor: Number(r.amount_minor), text: r.text,
  }));
  /* حسابُ المقهى المكتوب، وما اشتُرك بين مورّدين كثُر (حسابُنا مطبوعاً في كلّ حوالة ولم يُكتب في الإعدادات) */
  const ownIbans = new Set([
    ...own.flatMap((o) => (o.iban ? [normalizeIban(o.iban)] : [])),
    ...sharedIbans(guardTransfers),
  ]);
  const today = todayInRiyadh();
  const alerts = findIbanAlerts(
    supplierRows.map((s) => ({
      id: s.id,
      savedIban: s.iban ? normalizeIban(s.iban) : null,
      savedOn: s.ibanSetAt ? todayInRiyadh(s.ibanSetAt) : null,
    })),
    guardTransfers,
    ownIbans,
    windowStart(today),
  );

  const decisionOf = new Map(decided.map((d) => [d.key, d]));
  return alerts.flatMap((a): IbanAlertRow[] => {
    const s = info.get(a.supplierId);
    if (!s) return [];
    const key = ibanAlertKey(a.supplierId, a.seenIban);
    const d = decisionOf.get(key);
    return [{ ...a, supplierName: s.name, supplierSlug: s.slug, key, decision: d ? { at: d.at, note: d.note } : null }];
  });
}


export class IbanAlertGone extends Error {
  constructor() {
    super("هذا التنبيه لم يعد قائماً — ربما حدّث آيبان المورّد أو أعيد نسب الحوالة. حدّث الصفحة.");
  }
}

/**
 * «أعرفه» يُغلق السؤال عن هذا الحساب لهذا المورّد، و«OPEN» يعيده.
 * **الخادمُ لا يصدّق المتصفّح في أنّه تنبيه**: يعيد الاشتقاق من القاعدة، فإن لم يخرج
 * التنبيهُ بهذا المورّد وهذا الآيبان رُدّ الطلب.
 */
export async function resolveIbanAlert(
  t: Tx,
  input: { supplierId: string; iban: string; decision: "KNOWN" | "OPEN"; note: string | null },
  userId: string,
): Promise<IbanAlertRow> {
  const iban = normalizeIban(input.iban);
  const alert = (await loadIbanAlerts(t)).find((a) => a.supplierId === input.supplierId && a.seenIban === iban);
  if (!alert) throw new IbanAlertGone();

  const [before] = await t.select().from(alertResolutions).where(eq(alertResolutions.key, alert.key)).for("update");
  if (input.decision === "OPEN") {
    await t.delete(alertResolutions).where(eq(alertResolutions.key, alert.key));
  } else {
    await t.insert(alertResolutions)
      .values({ key: alert.key, decision: "KNOWN", note: input.note, userId })
      .onConflictDoUpdate({ target: alertResolutions.key, set: { decision: "KNOWN", note: input.note, userId, at: new Date() } });
  }
  await recordAudit({
    actorId: userId,
    action: "ALERT_RESOLVED",
    entityType: "alert",
    entityId: alert.key,
    before: before ? { القرار: "حساب له أعرفه", الملاحظة: before.note } : null,
    after: {
      القرار: input.decision === "OPEN" ? "أعيد فتحه" : "حساب له أعرفه",
      الملاحظة: input.note,
      المورّد: alert.supplierName,
      "الآيبان الذي حوّل إليه": alert.seenIban,
      "الحساب المعروف": alert.knownIbans,
      المبلغ_بالهللات: alert.totalMinor,
    },
  }, t);
  return alert;
}

/* ───────────────────── أوّلُ حوالةٍ إلى حسابٍ جديد ───────────────────── */

/** كم يوماً تبقى الحوالةُ الأولى «جديدة» — بعدها صار الحسابُ ممّا حُوِّل له من قبل. */
export const FIRST_TRANSFER_WINDOW_DAYS = 21;

export interface FirstTransferRow extends FirstTransfer {
  key: string;
  decision: { at: Date; note: string | null } | null;
}

/**
 * صادرٌ إلى آيبانٍ لم يُرَ قبل ثلاثة أسابيع. ما سأل عنه حارسُ المورّد (حسابٌ يخالف
 * المعروف) لا يُكرَّر هنا — ذاك سؤالٌ أشدّ وله بندُه.
 */
export async function loadFirstTransfers(
  reader: Conn = db,
  /** تنبيهاتُ حارس المورّد إن حُسبت سلفاً — كي لا يُقرأ الكشفُ لها مرّتين في الطلب. */
  known?: readonly IbanAlertRow[],
): Promise<FirstTransferRow[]> {
  const [transfers, own, decided, supplierAlerts] = await Promise.all([
    reader.execute<{ id: string; day: string; amount_minor: number; text: string; payee: string | null }>(sql`
      select bt.id,
             to_char(bt.value_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day,
             bt.amount_minor,
             coalesce(bt.description, '') || ' ' || coalesce(bt.beneficiary_raw, '') as text,
             coalesce(s.name_ar, cp.display_name, nullif(bt.beneficiary_raw, '')) as payee
        from bank_transactions bt
        left join suppliers s on s.id = bt.supplier_id
        left join counterparties cp on cp.id = bt.counterparty_id
       where bt.direction = 'DEBIT'
         and (bt.description ~* 'SA[0-9]{22}' or bt.beneficiary_raw ~* 'SA[0-9]{22}')
    `),
    reader.select({ iban: bankAccounts.iban }).from(bankAccounts),
    reader.select().from(alertResolutions).where(like(alertResolutions.key, "iban-first:%")),
    known ?? loadIbanAlerts(reader),
  ]);
  const today = todayInRiyadh();
  const since = new Date(`${today}T12:00:00Z`);
  since.setUTCDate(since.getUTCDate() - FIRST_TRANSFER_WINDOW_DAYS);
  const asked = new Set(supplierAlerts.map((a) => a.seenIban));
  const decisionOf = new Map(decided.map((d) => [d.key, d]));
  return findFirstTransfers(
    transfers.rows.map((r) => ({ id: r.id, day: r.day, amountMinor: Number(r.amount_minor), text: r.text, payee: r.payee })),
    new Set(own.flatMap((o) => (o.iban ? [normalizeIban(o.iban)] : []))),
    isoDay(since),
  )
    .filter((f) => !asked.has(f.iban))
    .map((f) => {
      const key = firstTransferKey(f.iban);
      const d = decisionOf.get(key);
      return { ...f, key, decision: d ? { at: d.at, note: d.note } : null };
    });
}

/** المفتوحُ من الحارسَين معاً — لعدّاد القشرة و«يحتاج قرارك»، بقراءةٍ واحدة لكلٍّ. */
export async function loadOpenIbanWatch(): Promise<{ alerts: IbanAlertRow[]; first: FirstTransferRow[] }> {
  const all = await loadIbanAlerts();
  const first = await loadFirstTransfers(db, all);
  return { alerts: all.filter((a) => a.decision === null), first: first.filter((f) => f.decision === null) };
}

/** «أعرفه» لمستفيدٍ جديد، أو إعادةُ فتحه — بالاشتقاق نفسِه في الخادم. */
export async function resolveFirstTransfer(
  t: Tx,
  input: { iban: string; decision: "KNOWN" | "OPEN"; note: string | null },
  userId: string,
): Promise<FirstTransferRow> {
  const iban = normalizeIban(input.iban);
  const row = (await loadFirstTransfers(t)).find((f) => f.iban === iban);
  if (!row) throw new IbanAlertGone();
  const [before] = await t.select().from(alertResolutions).where(eq(alertResolutions.key, row.key)).for("update");
  if (input.decision === "OPEN") {
    await t.delete(alertResolutions).where(eq(alertResolutions.key, row.key));
  } else {
    await t.insert(alertResolutions)
      .values({ key: row.key, decision: "KNOWN", note: input.note, userId })
      .onConflictDoUpdate({ target: alertResolutions.key, set: { decision: "KNOWN", note: input.note, userId, at: new Date() } });
  }
  await recordAudit({
    actorId: userId,
    action: "ALERT_RESOLVED",
    entityType: "alert",
    entityId: row.key,
    before: before ? { القرار: "مستفيد أعرفه", الملاحظة: before.note } : null,
    after: {
      القرار: input.decision === "OPEN" ? "أعيد فتحه" : "مستفيد أعرفه",
      الملاحظة: input.note,
      المستفيد: row.payee,
      الآيبان: row.iban,
      المبلغ_بالهللات: row.totalMinor,
    },
  }, t);
  return row;
}
