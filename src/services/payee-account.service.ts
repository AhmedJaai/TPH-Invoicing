/**
 * حسابُ المستفيد لكلّ مورّد — لملفّ التحويلات وللصفحة التي تسبقه.
 *
 * موضعٌ واحد يُسأل فيه، فلا تقول الصفحةُ حساباً ويكتب الملفُّ غيرَه.
 * والمصدرُ أدلّةُ الكشف القاطعة (`counterparty_evidence`) لجهةٍ أكّدها
 * إنسانٌ ونسبها إلى المورّد، وآيبانٌ يكتبه صاحبُ المقهى في ملفّ المورّد
 * (`suppliers.iban`، مفحوصٌ بـmod-97) لمن لا دليلَ له بعد.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { counterparties, counterpartyEvidence, suppliers } from "@/db/schema";
import { resolvePayeeAccount, type PayeeAccount } from "@/lib/payment-run";

export async function loadPayeeAccounts(supplierIds: readonly string[]): Promise<Map<string, PayeeAccount>> {
  const ids = [...new Set(supplierIds)];
  const evidence = ids.length === 0 ? [] : await db
    .select({
      supplierId: counterparties.supplierId,
      kind: counterpartyEvidence.kind,
      normalized: counterpartyEvidence.normalized,
    })
    .from(counterpartyEvidence)
    .innerJoin(counterparties, eq(counterparties.id, counterpartyEvidence.counterpartyId))
    .where(and(
      inArray(counterparties.supplierId, ids),
      inArray(counterpartyEvidence.kind, ["IBAN", "ACCOUNT"]),
    ));
  /* وما كتبه صاحبُ المقهى في ملفّ المورّد — لمن لم يُحوَّل له من قبل، أو غيّر حسابَه */
  const manual = ids.length === 0 ? [] : await db
    .select({ id: suppliers.id, iban: suppliers.iban })
    .from(suppliers)
    .where(inArray(suppliers.id, ids));
  const ibanOf = new Map(manual.map((m) => [m.id, m.iban]));
  return new Map(ids.map((id) => [id, resolvePayeeAccount(evidence.filter((e) => e.supplierId === id), ibanOf.get(id))]));
}
