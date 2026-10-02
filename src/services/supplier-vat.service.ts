/**
 * رقمُ المورّد الضريبيّ يُتعلَّم من فواتيره — مرّةً ويبقى.
 *
 * وُجد في الإنتاج (٣ أكتوبر ٢٠٢٦) ١٨ مورّداً بلا رقمٍ في سجلّه وفواتيرُه تحمله. والرقمُ هو
 * أوثقُ ما يُعرف به المورّدُ من فاتورةٍ جديدة (`matchSupplier`)؛ فبدونه يُعرف بالاسم وحده،
 * والاسمُ ليس هويّة. فإذا اتّفقت فاتورتان على رقمٍ سليم الشكل، ولم تحمل فواتيرُه رقماً
 * غيره، ولم يكن لمورّدٍ آخر — كُتب في سجلّه بأثرٍ في التدقيق.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { suppliers } from "@/db/schema";
import { isValidSaudiVat } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import type { Tx } from "./types";

export async function learnSupplierVat(tx: Tx, supplierId: string): Promise<string | null> {
  const [s] = await tx.select({ vat: suppliers.vatNumber, name: suppliers.nameAr }).from(suppliers).where(eq(suppliers.id, supplierId)).limit(1);
  if (!s || s.vat) return null;
  const rows = (await tx.execute<{ seller_vat: string; n: number }>(sql`
    select seller_vat, count(*)::int n from invoices where supplier_id = ${supplierId} and seller_vat is not null group by 1`)).rows
    .filter((r) => isValidSaudiVat(r.seller_vat));
  if (rows.length !== 1 || rows[0].n < 2) return null;
  const vat = rows[0].seller_vat;
  const [taken] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.vatNumber, vat)).limit(1);
  if (taken) return null;
  const done = await tx.update(suppliers).set({ vatNumber: vat })
    .where(and(eq(suppliers.id, supplierId), isNull(suppliers.vatNumber))).returning({ id: suppliers.id });
  if (done.length === 0) return null;
  await recordAudit({
    actorId: null, action: "SUPPLIER_VAT_LEARNED", entityType: "supplier", entityId: supplierId,
    after: { المورّد: s.name, الرقم: vat, المصدر: `${rows[0].n} فواتير تحمله ولا تحمل غيره` },
  }, tx);
  return vat;
}
