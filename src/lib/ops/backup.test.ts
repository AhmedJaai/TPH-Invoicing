import { describe, expect, it } from "vitest";
import {
  BACKUP_SECTIONS, PRE_DATA_PREAMBLE, buildSchemaSql, compareTables, contentHashSql, tableSelect,
  type Catalog,
} from "./backup";

const cat: Catalog = {
  enums: [{ sch: "public", name: "month_close_status", labels: ["OPEN", "CLOSED"] }],
  tables: [{ sch: "public", name: "month_closes" }],
  columns: [
    { sch: "public", tbl: "month_closes", col: "id", typ: "text", nn: true, def: null },
    { sch: "public", tbl: "month_closes", col: "status", typ: "month_close_status", nn: true, def: "'OPEN'::month_close_status" },
  ],
  constraints: [
    { sch: "public", tbl: "month_closes", name: "month_closes_pkey", kind: "p", def: "PRIMARY KEY (id)" },
  ],
  indexes: [{ sch: "public", name: "month_closes_status_idx", def: "CREATE INDEX month_closes_status_idx ON public.month_closes USING btree (status)" }],
  functions: [{
    sch: "public", name: "month_is_closed", args: "m text",
    def: "CREATE OR REPLACE FUNCTION public.month_is_closed(m text)\n RETURNS boolean\n LANGUAGE sql\nAS $$ select exists (select 1 from month_closes) $$",
  }],
  triggers: [{ sch: "public", name: "invoices_month_lock", def: "CREATE TRIGGER invoices_month_lock BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION month_lock()" }],
};

describe("مولِّد النسخة", () => {
  const { pre, post } = buildSchemaSql(cat);

  it("السطر الأوّل يُطفئ فحص أجسام الدوالّ — وإلّا سقطت الاستعادة عند month_is_closed", () => {
    expect(pre.split("\n")[0]).toBe(PRE_DATA_PREAMBLE);
    expect(PRE_DATA_PREAMBLE).toBe("set check_function_bodies = off;");
  });

  it("الدالّة قبل الجدول الذي تقرؤه، والجدول في ما قبل البيانات", () => {
    expect(pre.indexOf("month_is_closed")).toBeLessThan(pre.indexOf('create table "public"."month_closes"'));
    expect(pre.indexOf("create type")).toBeLessThan(pre.indexOf("create table"));
  });

  it("القيود والفهارس والمؤثِّرات بعد البيانات لا قبلها", () => {
    for (const s of ["PRIMARY KEY", "CREATE INDEX", "CREATE TRIGGER"]) {
      expect(pre).not.toContain(s);
      expect(post).toContain(s);
    }
    expect(post.indexOf("PRIMARY KEY")).toBeLessThan(post.indexOf("CREATE TRIGGER"));
  });

  it("ترتيب الأقسام: المخطّط ثمّ البيانات ثمّ القيود ثمّ البيان", () => {
    expect(BACKUP_SECTIONS).toEqual(["schema-pre-data.sql", "data", "schema-post-data.sql", "manifest.json"]);
  });

  it("رموز جوجل لا تُنسَخ، والجلسات لا تُنسَخ", () => {
    const accounts = tableSelect(`"public"."accounts"`, ["id", "refresh_token", "access_token", "id_token", "provider"]);
    expect(accounts).toContain('null::text as "refresh_token"');
    expect(accounts).toContain('null::text as "access_token"');
    expect(accounts).toContain('null::text as "id_token"');
    expect(accounts).toContain('"provider"');
    expect(tableSelect(`"public"."sessions"`, ["session_token"])).toMatch(/where false$/);
    expect(tableSelect(`"public"."invoices"`, ["id"])).toBe(`select "id" from "public"."invoices"`);
  });

  it("البصمة تُحسب على التعبير نفسه الذي نُسخ به", () => {
    expect(contentHashSql(`"public"."accounts"`, ["refresh_token"])).toContain(tableSelect(`"public"."accounts"`, ["refresh_token"]));
  });

  it("الجدول الغائب بعد الاستعادة لا يُعدّ مطابقاً", () => {
    const res = compareTables(
      { tables: { a: { n: 2, h: "x" }, b: { n: 0, h: "y" }, c: { n: 1, h: "z" } } },
      { a: { n: 2, h: "x" }, c: { n: 1, h: "other" } },
    );
    expect(res.map((r) => r.ok)).toEqual([true, false, false]);
  });
});
