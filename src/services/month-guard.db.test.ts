import { describe, expect, it } from "vitest";
import { invoices, monthCloses } from "@/db/schema";
import { createId } from "@/lib/id";
import { createInvoice } from "./invoice.service";
import { MonthClosedError } from "./validation.service";
import { caught, day, makeDocument, makeSupplier, pgErrorOf, withRollback } from "@/test/db";

const invoiceInput = (documentId: string, supplierId: string, periodMonth: string) => ({
  documentId,
  supplierId,
  invoiceNumber: `DBT-${createId().slice(0, 8)}`,
  invoiceDate: day(`${periodMonth}-15`),
  periodMonth,
  subtotalMinor: 1_000_00,
  vatMinor: 150_00,
  totalMinor: 1_150_00,
  taxStatus: "VALID" as const,
  inputVatStatus: "ELIGIBLE" as const,
  isFixedAsset: false,
});

describe("الشهر المقفل لا يُكتب فيه", () => {
  it("createInvoice في شهرٍ مقفل ← MonthClosedError", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await tx.insert(monthCloses).values({ month: "2026-07", status: "CLOSED" });
      const documentId = await makeDocument(tx, supplierId, "2026-07-15");

      const e = await caught(createInvoice(tx, invoiceInput(documentId, supplierId, "2026-07")));
      expect(e).toBeInstanceOf(MonthClosedError);
    }));

  it("وفي شهرٍ مفتوح تُنشأ — الحارس لا يرفض كلّ شيء", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await tx.insert(monthCloses).values({ month: "2026-07", status: "CLOSED" });
      const documentId = await makeDocument(tx, supplierId, "2026-08-15");
      expect(await createInvoice(tx, invoiceInput(documentId, supplierId, "2026-08"))).toEqual(expect.any(String));
    }));

  it("ومن تجاوز الخدمة وأدرج مباشرةً ردّته القاعدة (028)", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await tx.insert(monthCloses).values({ month: "2026-07", status: "CLOSED" });
      const documentId = await makeDocument(tx, supplierId, "2026-07-15");

      const input = invoiceInput(documentId, supplierId, "2026-07");
      const err = pgErrorOf(await caught(tx.insert(invoices).values({
        documentId: input.documentId, supplierId: input.supplierId, invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate, periodMonth: input.periodMonth, totalMinor: input.totalMinor,
        subtotalMinor: input.subtotalMinor, vatMinor: input.vatMinor,
      })));
      expect(err).not.toBeNull();
      expect(err?.message).toMatch(/2026-07|مقفل/);
    }));
});
