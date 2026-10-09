/**
 * تعديلُ بيانات المورّد الأساسيّة — الاسمُ والرقمُ الضريبيّ والسجلّ والتصنيف وأجلُ
 * السداد وحدُّ التنبيه والتواصلُ والآيبان.
 *
 * في معاملةٍ واحدة بقفل الصفّ، والتدقيقُ فيها بما تغيّر وحده (قبلُ وبعد).
 *
 * ── تحذيرٌ لا منع ──
 *
 * ما يختاره صاحبُ المقهى بيده لا يُردّ إلّا لخطأٍ قاطع (شكلُ الرقم، mod-97،
 * رقمٌ ضريبيّ مسجَّلٌ لمورّدٍ آخر — والقاعدةُ ترفضه أصلاً). وما عداه **يُسأل عنه
 * ثمّ يمضي بإقراره**: رقمٌ ضريبيّ تحمل فواتيرُه المقيَّدة غيرَه، واسمٌ يحمله
 * مورّدٌ آخر، وآيبانٌ يتغيّر أو يخالف ما حُوِّل له في الكشوف — وتغييرُ الآيبان
 * أشهرُ احتيالٍ في المدفوعات، فيُقال ذلك ولا يُحجَب.
 */
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { counterparties, counterpartyEvidence, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { INVOICE, countNoun } from "@/lib/arabic";
import { latinDigits } from "@/lib/invoice-number";
import { parseRiyals } from "@/lib/money";
import { normalizeIban, normalizePhoneE164, type SupplierProfileRequest } from "@/lib/supplier-edit";
import { normalizeName } from "@/lib/suppliers-seed";
import type { Tx } from "./types";

export class SupplierProfileError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message);
    this.name = "SupplierProfileError";
  }
}

export type SupplierProfileOutcome =
  | { kind: "saved"; changed: string[] }
  | { kind: "unchanged" }
  /** لم يُكتب شيء — يُعرض التنبيهُ ويُعاد الطلبُ بـ`confirm` */
  | { kind: "confirm"; warnings: string[] };

const blank = (v: string | undefined): string | null | undefined => (v === undefined ? undefined : v.trim() === "" ? null : v.trim());

export async function updateSupplierProfile(
  tx: Tx,
  req: SupplierProfileRequest,
  actorId: string,
): Promise<SupplierProfileOutcome> {
  const [cur] = await tx
    .select({
      id: suppliers.id, nameAr: suppliers.nameAr, nameEn: suppliers.nameEn, vatNumber: suppliers.vatNumber,
      crNumber: suppliers.crNumber, category: suppliers.category, paymentTermsDays: suppliers.paymentTermsDays,
      balanceAlertMinor: suppliers.balanceAlertMinor, phoneE164: suppliers.phoneE164, email: suppliers.email,
      contactName: suppliers.contactName, iban: suppliers.iban,
    })
    .from(suppliers)
    .where(eq(suppliers.id, req.supplierId))
    .for("update");
  if (!cur) throw new SupplierProfileError("لا مورّد بهذا المعرّف — حدّث الصفحة.", 404);

  /* الغائبُ لا يُمسّ، والفارغُ يمحو (يصير «غير معروف») */
  const vat = blank(req.vatNumber);
  const terms = blank(req.paymentTermsDays);
  const alert = blank(req.balanceAlert);
  const phone = blank(req.phone);
  const iban = blank(req.iban);
  const next = {
    nameAr: req.nameAr ?? cur.nameAr,
    nameEn: blank(req.nameEn) === undefined ? cur.nameEn : blank(req.nameEn) ?? null,
    vatNumber: vat === undefined ? cur.vatNumber : vat === null ? null : latinDigits(vat).replace(/\D/g, ""),
    crNumber: blank(req.crNumber) === undefined ? cur.crNumber : blank(req.crNumber) ?? null,
    category: req.category ?? cur.category,
    paymentTermsDays: terms === undefined ? cur.paymentTermsDays : terms === null ? null : Number(latinDigits(terms)),
    balanceAlertMinor: alert === undefined ? cur.balanceAlertMinor : alert === null ? null : parseRiyals(alert),
    phoneE164: phone === undefined ? cur.phoneE164 : phone === null ? null : normalizePhoneE164(phone),
    email: blank(req.email) === undefined ? cur.email : blank(req.email) ?? null,
    contactName: blank(req.contactName) === undefined ? cur.contactName : blank(req.contactName) ?? null,
    iban: iban === undefined ? cur.iban : iban === null ? null : normalizeIban(iban),
  };

  const LABEL: Record<keyof typeof next, string> = {
    nameAr: "الاسم", nameEn: "الاسم الإنجليزيّ", vatNumber: "الرقم الضريبيّ", crNumber: "السجلّ التجاريّ",
    category: "التصنيف", paymentTermsDays: "أجل السداد بالأيّام", balanceAlertMinor: "حدّ التنبيه بالهللات",
    phoneE164: "الجوّال", email: "البريد", contactName: "المندوب", iban: "الآيبان",
  };
  const keys = Object.keys(LABEL).filter((k): k is keyof typeof next => k in next);
  const changed = keys.filter((k) => next[k] !== cur[k]);
  if (changed.length === 0) return { kind: "unchanged" };

  /* ── القاطع: رقمٌ ضريبيّ لمورّدٍ آخر — هويّةٌ لا يحملها اثنان ── */
  if (changed.includes("vatNumber") && next.vatNumber) {
    const [other] = await tx
      .select({ nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(and(eq(suppliers.vatNumber, next.vatNumber), ne(suppliers.id, cur.id)))
      .limit(1);
    if (other) {
      throw new SupplierProfileError(`هذا الرقمُ الضريبيّ مسجَّلٌ لـ«${other.nameAr}» — إن كانا مورّداً واحداً فهو تكرارٌ يُدمَج، لا رقمٌ يُنسخ.`, 409);
    }
  }

  /* ── ما يُسأل عنه ثمّ يمضي بإقرار ── */
  const warnings: string[] = [];
  if (changed.includes("vatNumber") && next.vatNumber) {
    const [{ n }] = (await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from invoices
       where supplier_id = ${cur.id} and seller_vat is not null
         and regexp_replace(seller_vat, '\\D', '', 'g') <> ${next.vatNumber}
    `)).rows;
    if (Number(n) > 0) {
      warnings.push(`${countNoun(Number(n), INVOICE)} مقيَّدة لهذا المورّد تحمل رقماً ضريبيّاً غيرَ هذا — الفواتيرُ لا تتغيّر، فتحقّق أيُّ الرقمين الصحيح.`);
    }
  }
  if (changed.includes("nameAr")) {
    const others = await tx
      .select({ nameAr: suppliers.nameAr })
      .from(suppliers)
      .where(and(ne(suppliers.id, cur.id), eq(suppliers.isActive, true)));
    const clash = others.find((o) => normalizeName(o.nameAr) === normalizeName(next.nameAr));
    if (clash) warnings.push(`مورّدٌ آخر مسجَّلٌ بالاسم نفسه («${clash.nameAr}») — سيصعب التفريقُ بينهما.`);
  }
  if (changed.includes("iban") && next.iban) {
    if (cur.iban) warnings.push("تغييرُ آيبان مورّدٍ قائم أشهرُ احتيالٍ في المدفوعات — تأكّد من المورّد باتصالٍ على رقمه المعروف، لا من رسالةٍ وصلتك.");
    const seen = await tx
      .select({ normalized: counterpartyEvidence.normalized })
      .from(counterpartyEvidence)
      .innerJoin(counterparties, eq(counterparties.id, counterpartyEvidence.counterpartyId))
      .where(and(eq(counterparties.supplierId, cur.id), inArray(counterpartyEvidence.kind, ["IBAN"])));
    if (seen.length > 0 && !seen.some((e) => e.normalized === next.iban)) {
      warnings.push("هذا الآيبانُ يخالف الحسابَ الذي حُوِّل له في كشوف البنك — إن غيّر المورّدُ حسابَه فتأكّد منه أوّلاً.");
    }
  }
  if (warnings.length > 0 && !req.confirm) return { kind: "confirm", warnings };

  const ibanChanged = changed.includes("iban");
  await tx
    .update(suppliers)
    .set({
      ...next,
      ...(ibanChanged ? { ibanSetAt: next.iban ? new Date() : null, ibanSetById: next.iban ? actorId : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, cur.id));

  await recordAudit({
    actorId,
    action: "SUPPLIER_UPDATED",
    entityType: "supplier",
    entityId: cur.id,
    before: Object.fromEntries(changed.map((k) => [LABEL[k], cur[k]])),
    after: {
      ...Object.fromEntries(changed.map((k) => [LABEL[k], next[k]])),
      ...(warnings.length > 0 ? { "أُقرّ مع تنبيه": warnings } : {}),
    },
  }, tx);

  return { kind: "saved", changed: changed.map((k) => LABEL[k]) };
}
