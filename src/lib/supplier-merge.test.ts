import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { can, ROLES } from "./permissions";
import { deleteBlockers, duplicateHints, mergeConflicts, mergedBalance, MERGE_TABLES, type SupplierIdentity } from "./supplier-merge";
import { supplierBalance } from "./supplier-balances";

const sup = (over: Partial<SupplierIdentity>): SupplierIdentity => ({
  id: Math.random().toString(36).slice(2), slug: "s", nameAr: "مورّد", nameEn: null, vatNumber: null, iban: null, ...over,
});

describe("دمجُ المورّدين وحذفُهم — للمالك وحده", () => {
  it("supplier:merge للمالك وحده", () => {
    for (const r of ROLES) expect(can(r, "supplier:merge")).toBe(r === "OWNER");
  });

  it("الجداولُ المنقولة تغطّي كلَّ عمود supplier_id في المخطّط", () => {
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const tables = new Set<string>();
    let current = "";
    for (const line of schema.split("\n")) {
      const m = /pgTable\("([a-z_0-9]+)"/.exec(line);
      if (m) current = m[1];
      if (/\btext\("supplier_id"\)/.test(line)) tables.add(current);
    }
    expect([...tables].sort()).toEqual([...MERGE_TABLES].sort());
  });
});

describe("«عليك» بعد الدمج", () => {
  it("يُجمع الطرفان بالمعادلة نفسها — رصيدُ أحدهما يُخصم من فواتير الآخر", () => {
    const a = supplierBalance({ supplierId: "a", billedMinor: 1000, openMinor: 1000, openCount: 1, paidNetMinor: 0, creditMinor: 0, issuesInvoices: true });
    const b = supplierBalance({ supplierId: "b", billedMinor: 0, openMinor: 0, openCount: 0, paidNetMinor: 300, creditMinor: 300, issuesInvoices: true });
    const m = mergedBalance(a, b, true);
    expect(m.owedMinor).toBe(700);
    expect(m.creditLeftMinor).toBe(0);
  });
});

describe("التعارضُ والنسخ", () => {
  it("رقمان ضريبيّان مختلفان تعارض، وما يملكه المصدر وحده يُنسخ", () => {
    expect(mergeConflicts({ vatNumber: "3001", iban: null }, { vatNumber: "3002", iban: null }).conflicts.map((c) => c.field)).toEqual(["VAT"]);
    expect(mergeConflicts({ vatNumber: "3001", iban: "SA1" }, { vatNumber: null, iban: null }).copy).toEqual({ vatNumber: "3001", iban: "SA1" });
  });

  it("الحذفُ يمنعه المال وحده", () => {
    expect(deleteBlockers({ invoices: 0, payments: 0, statements: 0, bankTransactions: 0, inventoryReceipts: 0 })).toEqual([]);
    expect(deleteBlockers({ invoices: 2, payments: 0, statements: 0, bankTransactions: 1, inventoryReceipts: 0 }).map((b) => b.count)).toEqual([2, 1]);
  });
});

describe("مورّدون قد يكونون واحداً — تلميح لا دمج", () => {
  it("الرقمُ الضريبيّ نفسه أو الآيبانُ نفسه أو اسمان متقاربان", () => {
    const hints = duplicateHints([
      sup({ id: "1", nameAr: "غاناش", vatNumber: "300111" }),
      sup({ id: "2", nameAr: "شركة أخرى", vatNumber: "300111" }),
      sup({ id: "3", nameAr: "أوراق الزيتون", iban: "SA00 1" }),
      sup({ id: "4", nameAr: "مخبز", iban: "sa001" }),
      sup({ id: "5", nameAr: "لوريفا للتجارة" }),
      sup({ id: "6", nameAr: "لوريفا للتجاره" }),
    ]);
    expect(hints.map((h) => h.reason)).toEqual(["VAT", "IBAN", "NAME"]);
  });

  it("اسمان مختلفان تماماً لا يُلمَّح بهما، ورقمان ضريبيّان مختلفان لا يُلمَّح باسمهما", () => {
    expect(duplicateHints([sup({ nameAr: "حليب المراعي" }), sup({ nameAr: "بن السعادة" })])).toEqual([]);
    expect(duplicateHints([sup({ nameAr: "لوريفا", vatNumber: "1" }), sup({ nameAr: "لوريفا", vatNumber: "2" })])).toEqual([]);
  });
});
