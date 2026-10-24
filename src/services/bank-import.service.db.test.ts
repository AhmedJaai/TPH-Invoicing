import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { bankAccounts, monthCloses, users } from "@/db/schema";
import { createId } from "@/lib/id";
import type { BankRow } from "@/lib/bank/parse";
import { deriveLifecycle } from "@/lib/bank/lifecycle";
import { day, makeInvoice, makeSupplier, withRollback } from "@/test/db";
import { planStatementSync, rowKey, writeStatementImport, type StatementWriteResult } from "./bank-import.service";
import type { PlannedPayment, TransactionResult } from "./reconcile.service";
import type { Tx } from "./types";

/*
  الكتابةُ كما يكتبها `/api/bank-import`: المزامنةُ من `sync.ts` ثمّ الكتابةُ في معاملةٍ
  واحدة. والأيّامُ في ٢٠٩٩ كي لا تلتقي بحركات التجهيز (٢٠٢٦) في نافذة المقابلة.
*/

const row = (n: number, iso: string, amountMinor: number, description: string, extra: Partial<BankRow> = {}): BankRow => ({
  rowNumber: n, valueDate: day(iso), transactionType: "", description, amountMinor, direction: "DEBIT", ...extra,
});

async function someone(tx: Tx): Promise<string> {
  const [u] = await tx.insert(users).values({ email: `bank-${createId()}@test.local` }).returning({ id: users.id });
  return u.id;
}

async function account(tx: Tx): Promise<string> {
  const [a] = await tx.insert(bankAccounts)
    .values({ bankName: "بنك اختبار", label: "اختبار", accountNumber: `t-${createId()}` })
    .returning({ id: bankAccounts.id });
  return a.id;
}

interface Opts {
  userId: string;
  accountId: string | null;
  sha?: string;
  decisions?: ReadonlyMap<string, TransactionResult>;
  planned?: ReadonlyMap<string, PlannedPayment>;
}

async function importRows(tx: Tx, rows: BankRow[], o: Opts): Promise<StatementWriteResult & { closedRows: number }> {
  const times = rows.map((r) => r.valueDate.getTime());
  const plan = await planStatementSync(tx, rows, o.accountId, { start: new Date(Math.min(...times)), end: new Date(Math.max(...times)) });
  const out = await writeStatementImport(tx, {
    userId: o.userId,
    fileName: "statement.xlsx",
    fileSha256: o.sha ?? createId(),
    bank: "TEST",
    accountNumber: null,
    bankAccountId: o.accountId,
    rows,
    plan,
    decisions: o.decisions ?? new Map(),
    planned: o.planned ?? new Map(),
    reservedForHand: new Set(),
    adjudications: [],
    auditSummary: {},
  });
  return { ...out, closedRows: plan.inClosedMonth.length };
}

const n = async (tx: Tx, q: ReturnType<typeof sql>) => Number((await tx.execute<{ n: number }>(q)).rows[0].n);
const txsBetween = (tx: Tx, from: string, to: string) =>
  n(tx, sql`select count(*)::int as n from bank_transactions where value_date between ${`${from}T00:00:00Z`}::timestamptz and ${`${to}T00:00:00Z`}::timestamptz`);
const historyBetween = (tx: Tx, from: string, to: string) =>
  n(tx, sql`select count(*)::int as n from decision_history h join bank_transactions b on b.id = h.bank_transaction_id
             where b.value_date between ${`${from}T00:00:00Z`}::timestamptz and ${`${to}T00:00:00Z`}::timestamptz`);

describe("استيراد كشف البنك — معاملةٌ واحدة ودفعات، والهويّة من sync.ts", () => {
  it("الكشف نفسه مرّتين: الثانية لا تكتب حركةً ولا استيراداً ولا أثراً", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const accountId = await account(tx);
      const rows = [
        row(1, "2099-01-03", 120_00, "رسوم خدمة"),
        row(2, "2099-01-04", 5_000_00, "حوالة مورد البن"),
        row(3, "2099-01-04", 5_000_00, "حوالة مورد البن"), // حركتان متطابقتان حقّاً — تبقيان اثنتين
      ];
      const first = await importRows(tx, rows, { userId, accountId, sha: "sha-twice" });
      expect(first).toMatchObject({ newRows: 3, rejectedByConstraint: 0, alreadyImported: false });
      expect(await txsBetween(tx, "2099-01-01", "2099-01-31")).toBe(3);
      const history = await historyBetween(tx, "2099-01-01", "2099-01-31");
      expect(history).toBe(3);

      const second = await importRows(tx, rows, { userId, accountId, sha: "sha-twice" });
      expect(second).toMatchObject({ newRows: 0, rejectedByConstraint: 0, alreadyImported: true, importId: first.importId });
      expect(await txsBetween(tx, "2099-01-01", "2099-01-31")).toBe(3);
      expect(await historyBetween(tx, "2099-01-01", "2099-01-31")).toBe(history);
      expect(await n(tx, sql`select count(*)::int as n from bank_imports where file_sha256 = 'sha-twice'`)).toBe(1);
    }));

  it("كشفٌ يتداخل مع سابقه: يدخل ما بعد التداخل وحده", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const accountId = await account(tx);
      const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
      const of = (d: number, i: number) => row(i + 1, `2099-02-${String(d).padStart(2, "0")}`, 100_00 + d, `مشتريات يوم ${d}`);
      const a = await importRows(tx, days(1, 10).map(of), { userId, accountId });
      expect(a.newRows).toBe(10);
      const b = await importRows(tx, days(5, 15).map(of), { userId, accountId });
      expect(b.newRows).toBe(5);
      expect(await txsBetween(tx, "2099-02-01", "2099-02-28")).toBe(15);
    }));

  it("خمسمئة حركة في كشفٍ واحد: كلّها وأثرُ تصنيفها، والإعادة لا تكتب شيئاً", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const accountId = await account(tx);
      const rows = Array.from({ length: 500 }, (_, i) =>
        row(i + 1, `2099-04-${String((i % 28) + 1).padStart(2, "0")}`, 1_00 + i, `عملية رقم ${i}`));
      const first = await importRows(tx, rows, { userId, accountId, sha: "sha-500" });
      expect(first).toMatchObject({ newRows: 500, rejectedByConstraint: 0 });
      expect(await txsBetween(tx, "2099-04-01", "2099-04-30")).toBe(500);
      expect(await n(tx, sql`select count(*)::int as n from decision_history h join bank_transactions b on b.id = h.bank_transaction_id
                              where b.bank_import_id = ${first.importId} and h.event = 'CLASSIFIED' and h.detail = 'لا يوجد سبب مسجّل'`)).toBe(500);
      expect(await n(tx, sql`select new_row_count as n from bank_imports where id = ${first.importId}`)).toBe(500);

      const again = await importRows(tx, rows, { userId, accountId, sha: "sha-500" });
      expect(again.newRows).toBe(0);
      expect(await txsBetween(tx, "2099-04-01", "2099-04-30")).toBe(500);
    }));

  it("يكتب ما قرّره المحرّك بنصّه: المصدر والسبب والنسخة والطبقة وأثرها", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const rows = [row(1, "2099-05-02", 8_000_00, "ايجار المحل")];
      const key = rowKey(rows[0], 0);
      const decided: TransactionResult = {
        key, kind: "RENT", category: "RENT",
        classificationReason: "قاعدة: ايجار", classificationSource: "RULE", classificationRuleId: null,
        classificationVersion: "v-test", supplierId: null, supplierScore: 0, supplierEvidence: [],
        decision: null, candidate: null, outcome: "NOT_A_PAYMENT", runnerUpScore: null,
      };
      const out = await importRows(tx, rows, { userId, accountId: null, decisions: new Map([[key, decided]]) });
      const [t] = (await tx.execute<{ id: string; category: string; classification_source: string; classification_reason: string;
        classification_version: string; match_status: string; lifecycle: string; identity_key: string; external_id: string }>(sql`
        select id, category, classification_source, classification_reason, classification_version, match_status, lifecycle, identity_key, external_id
          from bank_transactions where bank_import_id = ${out.importId}`)).rows;
      expect(t).toMatchObject({
        category: "RENT", classification_source: "RULE", classification_reason: "قاعدة: ايجار",
        classification_version: "v-test", match_status: "IGNORED",
        lifecycle: deriveLifecycle({ classified: true, hasCandidate: false, decided: false, posted: false, ignored: true }),
      });
      /* الهويّةُ في العمودين، من sync.ts — المجهولُ حسابُه نطاقُه «~» */
      expect(t.identity_key).toMatch(/^FACT:~\|/);
      expect(t.external_id).toBe(t.identity_key);
      const [h] = (await tx.execute<{ actor: string; detail: string; payload: Record<string, string> }>(sql`
        select actor, detail, payload from decision_history where bank_transaction_id = ${t.id} and event = 'CLASSIFIED'`)).rows;
      expect(h).toEqual({ actor: "SYSTEM", detail: "قاعدة: ايجار", payload: { الباب: "RENT", المصدر: "RULE", النسخة: "v-test" } });
    }));

  it("السداد المخطَّط: دفعةٌ وتخصيصُها، والحركة مطابَقةٌ مقيَّدة بابُها المورّد", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const supplierId = await makeSupplier(tx);
      const invoiceId = await makeInvoice(tx, supplierId, 1_150_00, "2099-06-03");
      const rows = [row(1, "2099-06-10", 1_150_00, "حوالة الى مورد")];
      const key = rowKey(rows[0], 0);
      const plan: PlannedPayment = {
        transactionKey: key, supplierId, amountMinor: 1_150_00, paidAt: day("2099-06-10"),
        allocations: [{ invoiceId, amountMinor: 1_150_00 }], months: ["2099-06"], primaryMonth: "2099-06",
        feeMinor: 0, feeReason: null,
      };
      const out = await importRows(tx, rows, { userId, accountId: null, planned: new Map([[key, plan]]) });
      expect(out.created).toBe(1);
      const [t] = (await tx.execute<{ id: string; matched_payment_id: string | null; match_status: string; lifecycle: string; category: string; classification_source: string }>(sql`
        select id, matched_payment_id, match_status, lifecycle, category, classification_source from bank_transactions where bank_import_id = ${out.importId}`)).rows;
      expect(t).toMatchObject({ match_status: "MATCHED", lifecycle: "POSTED", category: "SUPPLIER", classification_source: "STRUCTURE" });
      expect(await n(tx, sql`select coalesce(sum(amount_minor), 0)::int as n from payment_allocations where invoice_id = ${invoiceId} and payment_id = ${t.matched_payment_id}`)).toBe(1_150_00);
      const events = (await tx.execute<{ event: string }>(sql`select event::text as event from decision_history where bank_transaction_id = ${t.id} order by event`)).rows.map((r) => r.event);
      expect(events).toEqual(["CLASSIFIED", "POSTED"]);
    }));

  it("إعادة كشفٍ يغطّي شهراً مقفلاً: تُثري المعروف ولا تُضيف، والمؤثِّر لا يردّها", () =>
    withRollback(async (tx) => {
      const userId = await someone(tx);
      const accountId = await account(tx);
      await importRows(tx, [row(1, "2099-07-05", 900_00, "TRANSFER ACME")], { userId, accountId });
      await tx.insert(monthCloses).values({ month: "2099-07", status: "CLOSED" });

      /* التصديرُ الثاني يحمل رقمَ العمليّة، ومعه حركةٌ جديدة في الشهر المقفل */
      const again = await importRows(tx, [
        row(1, "2099-07-05", 900_00, "TRANSFER ACME ABC123456789XY"),
        row(2, "2099-07-06", 50_00, "رسوم"),
      ], { userId, accountId });
      expect(again).toMatchObject({ newRows: 0, closedRows: 1 });
      expect(await txsBetween(tx, "2099-07-01", "2099-07-31")).toBe(1);
      const [t] = (await tx.execute<{ operation_ref: string | null }>(sql`
        select operation_ref from bank_transactions where value_date = ${"2099-07-05T00:00:00Z"}::timestamptz`)).rows;
      expect(t.operation_ref).not.toBeNull();
    }));
});
