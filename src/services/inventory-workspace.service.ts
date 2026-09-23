/**
 * ما تحتاجه ورشةُ الجرد فوق التقرير — لصفحتيها معاً.
 *
 * الكمّيّاتُ المستلَمة يدوياً في الأسبوع، واحتمالاتُ تكرارها مع فواتير
 * وصلت بعدها، والأرصدةُ الافتتاحيّة اليدويّة بوحدتها كما كُتبت،
 * والمورّدون (اختياريّون في الاستلام). وموضعٌ واحد كي لا تفترق
 * الصفحتان في ما تعرضانه.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, suppliers } from "@/db/schema";
import { storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import { milliToDecimal } from "@/lib/inventory/units";
import type { DuplicateRow, ReceiptRow } from "@/components/inventory-flow-step";
import { loadManualOpenings, loadReceiptDuplicates, type CountHeader } from "./inventory.service";
import { listReceipts } from "./inventory-receipt.service";
import type { Conn } from "./types";

export async function loadWorkspaceInputs(header: CountHeader, conn: Conn = db): Promise<{
  receipts: ReceiptRow[];
  duplicates: DuplicateRow[];
  suppliers: { id: string; name: string }[];
  manualOpenings: Map<string, { enteredMilli: number; unit: StoredUnit }>;
}> {
  const receipts = await listReceipts(header.periodStart, header.periodEnd, header.branchId, conn);

  const units = await conn.select({ id: products.id, baseUnit: products.baseUnit })
    .from(products).where(eq(products.isStockItem, true));
  const duplicates = await loadReceiptDuplicates(
    header.periodStart, header.periodEnd, header.branchId, new Map(units.map((u) => [u.id, u.baseUnit])), conn,
  );

  const supplierRows = await conn.select({ id: suppliers.id, name: suppliers.nameAr })
    .from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.nameAr));

  return {
    receipts: receipts.map((r) => ({
      id: r.id,
      productId: r.productId,
      receivedOn: r.receivedOn,
      quantityText: `${milliToDecimal(r.enteredMilli)} ${storedUnitLabel(r.unit)}`,
      costMinor: r.costMinor,
      supplierName: r.supplierName,
      documentRef: r.documentRef,
      linkedInvoiceNumber: r.linkedInvoiceNumber,
      confirmedSeparate: r.confirmedSeparate,
    })),
    duplicates: duplicates.map((d) => ({
      receiptId: d.receiptId,
      productId: d.productId,
      invoiceLineId: d.invoiceLineId,
      invoiceNumber: d.invoiceNumber,
      supplierName: d.supplierName,
      effectiveDate: d.effectiveDate,
      basis: d.basis,
    })),
    suppliers: supplierRows,
    manualOpenings: await loadManualOpenings(header.id, conn),
  };
}
