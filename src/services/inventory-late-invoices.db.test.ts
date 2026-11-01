import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, invoices, monthCloses, users } from "@/db/schema";
import { loadLateInvoices, setInvoiceReceivedOn } from "./inventory-late-invoices.service";
import { loadPurchaseLines } from "./inventory.service";
import { replaceLines } from "./invoice.service";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import { caught, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import type { Tx } from "./types";

/**
 * قرارُ «متى وصلت بضاعتُها» يغيّر ما يُحسب في الجرد — وهو الزرُّ الذي كان غائباً: العمودُ يُقدَّم في
 * الاستعلام ولا شيء يكتبه. فالإثبات: القرارُ يُكتب، ويُخرج الفاتورةَ من الالتباس، ويُدخلها أو يُخرجها بيومه.
 * والتواريخُ نسبةً إلى اليوم، فـ«لا بعد اليوم» لا تُسقطها.
 */
async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `t-${Date.now()}-${Math.random()}@test.local` }).returning({ id: users.id });
  return u.id;
}

/** جردٌ انتهى قبل عشرة أيام، وفاتورةٌ بعده بيومين ببندٍ واحد. */
async function setup(tx: Tx) {
  const periodEnd = addDays(todayInRiyadh(), -10);
  const periodStart = addDays(periodEnd, -6);
  const invoiceDay = addDays(periodEnd, 2);
  const supplierId = await makeSupplier(tx);
  const invoiceId = await makeInvoice(tx, supplierId, 1_150_00, invoiceDay);
  await replaceLines(tx, {
    invoiceId, supplierId, invoiceDate: new Date(`${invoiceDay}T09:00:00+03:00`), subtotalMinor: 1_000_00,
    lines: [{ description: "حليب كامل الدسم 12 لتر", quantity: "10", unitPrice: "100", lineTotal: "1000" }],
  });
  return { periodStart, periodEnd, invoiceDay, invoiceId, me: await someone(tx) };
}

describe("يوم وصول بضاعة الفاتورة", () => {
  it("بعد نهاية الجرد بيومين: التباس، ثمّ «بعد الجرد» يُخرجها منه ولا يُدخلها", () =>
    withRollback(async (tx) => {
      const s = await setup(tx);
      const before = await loadPurchaseLines(s.periodStart, s.periodEnd, tx);
      expect(before.ambiguous.some((l) => l.invoiceId === s.invoiceId)).toBe(true);
      expect((await loadLateInvoices(s.periodEnd, tx)).find((r) => r.invoiceId === s.invoiceId)?.receivedOn).toBeNull();

      await setInvoiceReceivedOn(s.invoiceId, s.invoiceDay, s.me, tx);
      const after = await loadPurchaseLines(s.periodStart, s.periodEnd, tx);
      expect(after.ambiguous.some((l) => l.invoiceId === s.invoiceId)).toBe(false);
      expect(after.inPeriod.some((l) => l.invoiceId === s.invoiceId)).toBe(false);
      expect((await loadLateInvoices(s.periodEnd, tx)).find((r) => r.invoiceId === s.invoiceId)?.receivedOn).toBe(s.invoiceDay);
    }));

  it("«قبل نهايته» يُدخلها في الجرد، و«غيّر القرار» يعيد السؤال", () =>
    withRollback(async (tx) => {
      const s = await setup(tx);
      await setInvoiceReceivedOn(s.invoiceId, s.periodEnd, s.me, tx);
      const counted = await loadPurchaseLines(s.periodStart, s.periodEnd, tx);
      expect(counted.ambiguous.some((l) => l.invoiceId === s.invoiceId)).toBe(false);
      expect(counted.inPeriod.some((l) => l.invoiceId === s.invoiceId)).toBe(true);

      await setInvoiceReceivedOn(s.invoiceId, null, s.me, tx);
      const again = await loadPurchaseLines(s.periodStart, s.periodEnd, tx);
      expect(again.ambiguous.some((l) => l.invoiceId === s.invoiceId)).toBe(true);
    }));

  it("يُكتب أثرُه مرّةً واحدة، وتكرارُه لا يكتب ثانيةً، وما بعد اليوم يُرفض ولا يُكتب", () =>
    withRollback(async (tx) => {
      const s = await setup(tx);
      await setInvoiceReceivedOn(s.invoiceId, s.invoiceDay, s.me, tx);
      await setInvoiceReceivedOn(s.invoiceId, s.invoiceDay, s.me, tx);
      const logs = await tx.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, s.invoiceId));
      expect(logs.filter((l) => l.action === "INVENTORY_INVOICE_RECEIVED_SET")).toHaveLength(1);

      const tomorrow = addDays(todayInRiyadh(), 1);
      expect(await caught(setInvoiceReceivedOn(s.invoiceId, tomorrow, s.me, tx))).toBeInstanceOf(Error);
      const [row] = await tx.select({ r: invoices.receivedOn }).from(invoices).where(eq(invoices.id, s.invoiceId));
      expect(row.r).toBe(s.invoiceDay);
    }));

  it("لا يمنعه قفلُ الشهر: هو يومُ وصولٍ لا مبلغ", () =>
    withRollback(async (tx) => {
      const s = await setup(tx);
      await tx.insert(monthCloses).values({ month: s.invoiceDay.slice(0, 7), status: "CLOSED" }).onConflictDoNothing();
      await expect(setInvoiceReceivedOn(s.invoiceId, s.invoiceDay, s.me, tx)).resolves.toMatchObject({ receivedOn: s.invoiceDay });
    }));
});
