import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";
import { withRollback } from "@/test/db";
import { latteSalesFile, makeActor } from "@/test/inventory";
import { importSalesFile } from "./sales-import.service";

/** «مزيجُ المنتجات»: لا رقمَ طلب — بيعةٌ واحدة لكلّ يوم. */
function productMixFile(qty: number, date: string, branch?: string): Buffer {
  const header = ["sku", "name", "unit_price", "quantity", "total_price", "business_date", ...(branch ? ["branch_name"] : [])];
  const row = ["SKU-LATTE", "Spanish Latte", 18, qty, 18 * qty, date, ...(branch ? [branch] : [])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row]), "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const unitsOn = async (tx: Parameters<Parameters<typeof withRollback>[0]>[0], day: string) =>
  Number((await tx.execute<{ q: string }>(sql`
    select coalesce(sum(sl.quantity), 0)::text as q from sale_lines sl join sales s on s.id = sl.sale_id
     where s.business_date::date = ${day}::date
  `)).rows[0].q);

describe("تقريرا فودكس لليوم نفسه لا يُحسبان معاً", () => {
  it("مزيجُ المنتجات ليومٍ استُورد بأصناف الطلبات يُرفض ولا يُكتب", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const day = "2099-03-10";
      await importSalesFile({ buffer: latteSalesFile(3, day, "OVL"), fileName: "orders.xlsx", actorId }, tx);
      const before = await unitsOn(tx, day);

      const r = await importSalesFile({ buffer: productMixFile(3, day), fileName: "mix.xlsx", actorId }, tx);
      expect(r.status).toBe("FAILED");
      expect(r.blocked).toContain(day);
      expect(await unitsOn(tx, day)).toBe(before);
    }));

  it("ومزيجُ المنتجات للفرع نفسه بتسميتين مفتاحٌ واحد — لا بيعتان", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      const day = "2099-03-11";
      const code = `T-${Math.random().toString(36).slice(2, 8)}`;
      await tx.execute(sql`insert into branches (id, name_ar, name_en, code) values (${code}, 'فرع الاختبار', 'Test Branch', ${code})`);
      await importSalesFile({ buffer: productMixFile(4, day, "فرع الاختبار"), fileName: "mix-ar.xlsx", actorId }, tx);
      /* الملفُّ نفسُه مصحَّحاً، والفرعُ باسمه الإنجليزيّ */
      await importSalesFile({ buffer: productMixFile(5, day, "Test Branch"), fileName: "mix-en.xlsx", actorId }, tx);
      const [n] = (await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from sales where business_date::date = ${day}::date
      `)).rows;
      expect(n.n).toBe(1);
    }));
});

describe("تصديرٌ مصحَّح نقص فيه صنفٌ من طلب", () => {
  const HEADER = ["order_reference", "order_status", "type", "parent_item_sku", "status", "sku", "name", "unit_price", "quantity", "total_price", "business_date", "branch_name"];
  const file = (rows: (string | number)[][]) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...rows]), "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };
  const latte = ["ORD-FIX-1", "Done", "المنتج", "", "Done", "SKU-LATTE", "Spanish Latte", 18, 1, 18, "2099-04-02", "Branch 1"];
  const cake = ["ORD-FIX-1", "Done", "المنتج", "", "Done", "SKU-CAKE", "Cheesecake", 22, 1, 22, "2099-04-02", "Branch 1"];

  it("السطرُ الغائب يُلغى ولا يُحذف — ولا يبقى محسوباً", () =>
    withRollback(async (tx) => {
      const actorId = await makeActor(tx);
      await importSalesFile({ buffer: file([latte, cake]), fileName: "orders-v1.xlsx", actorId }, tx);
      const r = await importSalesFile({ buffer: file([latte]), fileName: "orders-v2.xlsx", actorId }, tx);
      expect(r.revisions.some((x) => x.now.includes("غاب عن التصدير"))).toBe(true);

      const lines = (await tx.execute<{ d: string; v: boolean }>(sql`
        select sl.description as d, sl.is_void as v from sale_lines sl join sales s on s.id = sl.sale_id
         where s.external_id = 'FDX:ORD-FIX-1' order by sl.description
      `)).rows;
      expect(lines).toEqual([{ d: "Cheesecake", v: true }, { d: "Spanish Latte", v: false }]);
    }));
});
