import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  planAllocations,
  planCreditApplication,
  settleSupplierAccount,
  SETTLEMENT_FORWARD_DAYS,
  type AvailableCredit,
  type OpenInvoice,
} from "./allocation";

/**
 * خصائصُ التخصيص — لا أمثلتُه.
 *
 * `allocation.test.ts` حالاتٌ كتبها إنسانٌ تخيَّلها. وهذه تولّد دفعاتٍ وفواتيرَ
 * عشوائيّة (أعداداً صحيحة) وتسأل عن الثوابت نفسها: لا يُخلَق مالٌ ولو بهللة،
 * ولا تأخذ فاتورةٌ فوق مفتوحها، والأقدمُ أوّلاً، والنتيجةُ لا يغيّرها ترتيبُ
 * المدخل. والبذرةُ ثابتة، فالفشلُ يُعاد كما وقع.
 */
const RUNS = { numRuns: 1000, seed: 20261010 };
const DAY = 86_400_000;
const BASE = Date.UTC(2026, 0, 1);

const amount = fc.integer({ min: 0, max: 5_000_000 });
const invoiceArb: fc.Arbitrary<OpenInvoice> = fc.record({
  invoiceId: fc.constantFrom("a", "b", "c", "d", "e", "f", "g", "h", "i", "j"),
  invoiceDate: fc.integer({ min: 0, max: 60 }).map((d) => new Date(BASE + d * DAY)),
  // السالبُ والصفرُ يدخلان عمداً: فاتورةٌ زاد سدادُها أو سُدّدت لا تأخذ شيئاً
  outstandingMinor: fc.integer({ min: -1_000, max: 2_000_000 }),
});
/** معرّفٌ واحد لكلّ فاتورة — كما في القاعدة */
const invoicesArb = fc.uniqueArray(invoiceArb, { selector: (i) => i.invoiceId, maxLength: 10 });
const paidAtArb = fc.integer({ min: 0, max: 60 }).map((d) => new Date(BASE + d * DAY));

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe("planAllocations — خصائص", () => {
  const requests = fc.array(
    fc.record({ invoiceId: fc.string({ maxLength: 3 }), amountMinor: fc.integer({ min: -1_000, max: 2_000_000 }) }),
    { maxLength: 12 },
  );

  it("لا يُخصَّص فوق المتاح، والمخصَّصُ + الباقي = المتاح بالهللة", () => {
    fc.assert(fc.property(amount, amount, requests, (payment, already, reqs) => {
      const p = planAllocations(payment, already, reqs);
      const available = Math.max(0, payment - already);
      expect(p.allocatedMinor).toBe(sum(p.allocations.map((a) => a.amountMinor)));
      expect(p.allocatedMinor).toBeLessThanOrEqual(available);
      expect(p.allocatedMinor + p.remainingMinor).toBe(available);
      expect(p.remainingMinor).toBeGreaterThanOrEqual(0);
    }), RUNS);
  });

  it("كلُّ سطرٍ موجبٌ صحيح ولا يتجاوز ما طُلب له", () => {
    fc.assert(fc.property(amount, amount, requests, (payment, already, reqs) => {
      const p = planAllocations(payment, already, reqs);
      // السطورُ تتبع ترتيبَ الطلبات: يُمشى عليهما معاً
      let i = 0;
      for (const a of p.allocations) {
        while (i < reqs.length && !(reqs[i].invoiceId === a.invoiceId && reqs[i].amountMinor > 0)) i += 1;
        expect(i).toBeLessThan(reqs.length);
        expect(Number.isInteger(a.amountMinor)).toBe(true);
        expect(a.amountMinor).toBeGreaterThan(0);
        expect(a.amountMinor).toBeLessThanOrEqual(reqs[i].amountMinor);
        i += 1;
      }
    }), RUNS);
  });

  it("المطلوبُ = المخصَّص + العجز، ولا عجزَ وباقٍ معاً", () => {
    fc.assert(fc.property(amount, amount, requests, (payment, already, reqs) => {
      const p = planAllocations(payment, already, reqs);
      const wanted = sum(reqs.map((r) => Math.max(0, r.amountMinor)));
      expect(p.allocatedMinor + p.shortfallMinor).toBe(wanted);
      // من بقي له مالٌ لم يعجز عن طلب، ومن عجز لم يبقَ له مال
      expect(Math.min(p.shortfallMinor, p.remainingMinor)).toBe(0);
    }), RUNS);
  });
});

describe("settleSupplierAccount — خصائص", () => {
  it("لا تأخذ فاتورةٌ فوق مفتوحها، ولا يتجاوز المجموعُ الحوالة", () => {
    fc.assert(fc.property(amount, paidAtArb, invoicesArb, (payment, paidAt, invoices) => {
      const p = settleSupplierAccount(payment, paidAt, invoices);
      const open = new Map(invoices.map((i) => [i.invoiceId, i.outstandingMinor]));
      expect(p.allocatedMinor).toBeLessThanOrEqual(payment);
      expect(p.allocatedMinor + p.remainingMinor).toBe(payment);
      const seen = new Set<string>();
      for (const a of p.allocations) {
        expect(seen.has(a.invoiceId)).toBe(false);
        seen.add(a.invoiceId);
        expect(a.amountMinor).toBeGreaterThan(0);
        expect(a.amountMinor).toBeLessThanOrEqual(open.get(a.invoiceId) ?? 0);
      }
    }), RUNS);
  });

  it("ترتيبُ المدخل لا يغيّر الخطّة", () => {
    fc.assert(fc.property(
      amount, paidAtArb,
      invoicesArb.chain((inv) => fc.tuple(fc.constant(inv), fc.shuffledSubarray(inv, { minLength: inv.length }))),
      (payment, paidAt, [invoices, shuffled]) => {
        expect(settleSupplierAccount(payment, paidAt, shuffled))
          .toEqual(settleSupplierAccount(payment, paidAt, invoices));
      },
    ), RUNS);
  });

  it("الأقدمُ أوّلاً: لا يُمسّ أحدثُ وأقدمُ منه مؤهَّلٌ ما زال مفتوحاً", () => {
    fc.assert(fc.property(amount, paidAtArb, invoicesArb, (payment, paidAt, invoices) => {
      const p = settleSupplierAccount(payment, paidAt, invoices);
      const got = new Map(p.allocations.map((a) => [a.invoiceId, a.amountMinor]));
      const horizon = paidAt.getTime() + SETTLEMENT_FORWARD_DAYS * DAY;
      const eligible = invoices.filter((i) => i.outstandingMinor > 0 && i.invoiceDate.getTime() <= horizon);
      for (const older of eligible) {
        const leftOpen = older.outstandingMinor - (got.get(older.invoiceId) ?? 0);
        if (leftOpen === 0) continue;
        for (const newer of eligible) {
          if (newer.invoiceDate.getTime() > older.invoiceDate.getTime()) {
            expect(got.get(newer.invoiceId) ?? 0).toBe(0);
          }
        }
      }
    }), RUNS);
  });

  it("ما بعد أفق السبعة أيّام لا يُسدَّد آلياً، وما بقي من مالٍ بقي لأنّ المؤهَّل سُدّ كلُّه", () => {
    fc.assert(fc.property(amount, paidAtArb, invoicesArb, (payment, paidAt, invoices) => {
      const p = settleSupplierAccount(payment, paidAt, invoices);
      const horizon = paidAt.getTime() + SETTLEMENT_FORWARD_DAYS * DAY;
      const byId = new Map(invoices.map((i) => [i.invoiceId, i]));
      for (const a of p.allocations) {
        expect(byId.get(a.invoiceId)!.invoiceDate.getTime()).toBeLessThanOrEqual(horizon);
      }
      const eligibleOpen = sum(invoices
        .filter((i) => i.outstandingMinor > 0 && i.invoiceDate.getTime() <= horizon)
        .map((i) => i.outstandingMinor));
      expect(p.allocatedMinor).toBe(Math.min(payment, eligibleOpen));
    }), RUNS);
  });
});

describe("planCreditApplication — خصائص", () => {
  const creditArb: fc.Arbitrary<AvailableCredit> = fc.record({
    paymentId: fc.constantFrom("p1", "p2", "p3", "p4", "p5", "p6"),
    paidAt: paidAtArb,
    availableMinor: fc.integer({ min: -1_000, max: 2_000_000 }),
  });
  const creditsArb = fc.uniqueArray(creditArb, { selector: (c) => c.paymentId, maxLength: 6 });
  const forward = fc.option(fc.integer({ min: 0, max: 30 }), { nil: null });

  it("المالُ محفوظ: المطبَّق + الباقي = الرصيد، والمطبَّق + المفتوح = الفواتير", () => {
    fc.assert(fc.property(creditsArb, invoicesArb, forward, (credits, invoices, forwardDays) => {
      const p = planCreditApplication(credits, invoices, { forwardDays });
      const credit = sum(credits.map((c) => Math.max(0, c.availableMinor)));
      const open = sum(invoices.map((i) => Math.max(0, i.outstandingMinor)));
      expect(p.appliedMinor).toBe(sum(p.allocations.map((a) => a.amountMinor)));
      expect(p.appliedMinor + p.creditLeftMinor).toBe(credit);
      expect(p.appliedMinor + p.openLeftMinor).toBe(open);
    }), RUNS);
  });

  it("لا دفعةٌ تُعطي فوق متاحها ولا فاتورةٌ تأخذ فوق مفتوحها", () => {
    fc.assert(fc.property(creditsArb, invoicesArb, forward, (credits, invoices, forwardDays) => {
      const p = planCreditApplication(credits, invoices, { forwardDays });
      const given = new Map<string, number>();
      const taken = new Map<string, number>();
      for (const a of p.allocations) {
        expect(a.amountMinor).toBeGreaterThan(0);
        given.set(a.paymentId, (given.get(a.paymentId) ?? 0) + a.amountMinor);
        taken.set(a.invoiceId, (taken.get(a.invoiceId) ?? 0) + a.amountMinor);
      }
      for (const c of credits) expect(given.get(c.paymentId) ?? 0).toBeLessThanOrEqual(Math.max(0, c.availableMinor));
      for (const i of invoices) expect(taken.get(i.invoiceId) ?? 0).toBeLessThanOrEqual(Math.max(0, i.outstandingMinor));
    }), RUNS);
  });

  it("الآليُّ لا يسدّد فاتورةً بعد أفق دفعتها، وبيد الإنسان (null) لا أفق", () => {
    fc.assert(fc.property(creditsArb, invoicesArb, fc.integer({ min: 0, max: 30 }), (credits, invoices, forwardDays) => {
      const auto = planCreditApplication(credits, invoices, { forwardDays });
      const paidAt = new Map(credits.map((c) => [c.paymentId, c.paidAt.getTime()]));
      const dated = new Map(invoices.map((i) => [i.invoiceId, i.invoiceDate.getTime()]));
      for (const a of auto.allocations) {
        expect(dated.get(a.invoiceId)!).toBeLessThanOrEqual(paidAt.get(a.paymentId)! + forwardDays * DAY);
      }
      const manual = planCreditApplication(credits, invoices, { forwardDays: null });
      // بلا أفقٍ يُطبَّق أقصى الممكن: أحدُ الطرفين ينفد
      expect(Math.min(manual.creditLeftMinor, manual.openLeftMinor)).toBe(0);
      expect(manual.appliedMinor).toBeGreaterThanOrEqual(auto.appliedMinor);
    }), RUNS);
  });

  it("ترتيبُ المدخل لا يغيّر الخطّة", () => {
    fc.assert(fc.property(
      creditsArb.chain((c) => fc.tuple(fc.constant(c), fc.shuffledSubarray(c, { minLength: c.length }))),
      invoicesArb.chain((i) => fc.tuple(fc.constant(i), fc.shuffledSubarray(i, { minLength: i.length }))),
      forward,
      ([credits, creditsShuffled], [invoices, invoicesShuffled], forwardDays) => {
        expect(planCreditApplication(creditsShuffled, invoicesShuffled, { forwardDays }))
          .toEqual(planCreditApplication(credits, invoices, { forwardDays }));
      },
    ), RUNS);
  });
});
