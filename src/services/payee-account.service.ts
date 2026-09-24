/**
 * حسابُ المستفيد لكلّ مورّد — لملفّ التحويلات وللصفحة التي تسبقه.
 *
 * موضعٌ واحد يُسأل فيه، فلا تقول الصفحةُ حساباً ويكتب الملفُّ غيرَه.
 * والمصدرُ أدلّةُ الكشف القاطعة (`counterparty_evidence`) لجهةٍ أكّدها
 * إنسانٌ ونسبها إلى المورّد — لا مدخلٌ حرّ.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { counterparties, counterpartyEvidence } from "@/db/schema";
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
  return new Map(ids.map((id) => [id, resolvePayeeAccount(evidence.filter((e) => e.supplierId === id))]));
}
