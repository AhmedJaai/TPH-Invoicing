import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { payments } from "@/db/schema";
import {
  PaymentTwinError, allocate, createPayment, recordBankPayment,
} from "./payment.service";
import { caught, day, makeInvoice, makeSupplier, pgErrorOf, withRollback } from "@/test/db";
import type { Tx } from "./types";

async function livePayments(tx: Tx, supplierId: string) {
  return tx
    .select({ id: payments.id, paidAt: payments.paidAt })
    .from(payments)
    .where(and(eq(payments.supplierId, supplierId), sql`${payments.status} not in ('REVERSED','VOID')`));
}

describe("createPayment — الواقعة الواحدة لا تُقيَّد دفعتين", () => {
  it("توأمٌ بنفس المورّد واليوم والمبلغ بلا إقرار ← PaymentTwinError، ولا يُكتب شيء", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const first = await createPayment(tx, {
        supplierId, paidAt: day("2026-08-25"), amountMinor: 945_00, method: "BANK_TRANSFER",
      });

      const e = await caught(createPayment(tx, {
        supplierId, paidAt: day("2026-08-25"), amountMinor: 945_00, method: "BANK_TRANSFER",
      }));
      expect(e).toBeInstanceOf(PaymentTwinError);
      expect((e as PaymentTwinError).twin.id).toBe(first);
      expect(await livePayments(tx, supplierId)).toHaveLength(1);
    }));

  it("ومع الإقرار بأنّها واقعةٌ أخرى تُنشأ الثانية — بيكوف يُدفَع له مرّتين حقيقةً", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const input = { supplierId, paidAt: day("2026-08-25"), amountMinor: 150_00, method: "BANK_TRANSFER" as const };
      await createPayment(tx, input);
      await createPayment(tx, { ...input, acknowledgeTwin: true });
      expect(await livePayments(tx, supplierId)).toHaveLength(2);
    }));
});

describe("recordBankPayment — الكشف يتبنّى ولا ينسخ", () => {
  it("قيدٌ يدويّ قبل الحوالة بخمسة أيّام يُتبنّى، ويأخذ تاريخ الكشف، ولا تُنشأ ثانية", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const manual = await createPayment(tx, {
        supplierId, paidAt: day("2026-08-20"), amountMinor: 2_500_00, method: "BANK_TRANSFER",
      });

      const res = await recordBankPayment(tx, {
        supplierId, paidAt: day("2026-08-25"), amountMinor: 2_500_00, method: "BANK_TRANSFER",
        beneficiaryNameRaw: "من الكشف",
      });

      expect(res).toEqual({ id: manual, adopted: true });
      const rows = await livePayments(tx, supplierId);
      expect(rows).toHaveLength(1);
      expect(rows[0].paidAt.toISOString().slice(0, 10)).toBe("2026-08-25");
    }));

  it("ولا يتبنّى ما بعُد أكثر من أسبوعين — تلك واقعةٌ أخرى", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      await createPayment(tx, {
        supplierId, paidAt: day("2026-08-01"), amountMinor: 2_500_00, method: "BANK_TRANSFER",
      });
      const res = await recordBankPayment(tx, {
        supplierId, paidAt: day("2026-08-25"), amountMinor: 2_500_00, method: "BANK_TRANSFER",
      });
      expect(res.adopted).toBe(false);
      expect(await livePayments(tx, supplierId)).toHaveLength(2);
    }));
});

describe("التخصيص فوق الفاتورة — القاعدة ترفضه (026)", () => {
  it("دفعتان بثلاثة آلاف على فاتورةٍ بثلاثة آلاف ← الثانية تُرَدّ بقيد الفاتورة", () =>
    withRollback(async (tx) => {
      const supplierId = await makeSupplier(tx);
      const invoiceId = await makeInvoice(tx, supplierId, 3_000_00, "2026-08-10");

      const a = await createPayment(tx, {
        supplierId, paidAt: day("2026-08-20"), amountMinor: 3_000_00, method: "BANK_TRANSFER",
      });
      await allocate(tx, a, 3_000_00, [{ invoiceId, amountMinor: 3_000_00 }]);

      const b = await createPayment(tx, {
        supplierId, paidAt: day("2026-08-21"), amountMinor: 3_000_00, method: "BANK_TRANSFER",
      });
      /*
        `planAllocations` يحدّ بما بقي من **الدفعة** لا من الفاتورة — فالحدّ
        الثاني في القاعدة وحدها، وهو ما يمنع السداد المزدوج بين طلبين.
      */
      const err = pgErrorOf(await caught(allocate(tx, b, 3_000_00, [{ invoiceId, amountMinor: 3_000_00 }])));
      expect(err?.code).toBe("23514");
      expect(err?.message).toMatch(/الفاتورة/);
    }));
});
