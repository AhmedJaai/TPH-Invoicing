import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { actualShape, declaredShape, schemaDrift, type InformationSchemaColumn } from "@/lib/ops/schema-drift";

/*
  المخطّطُ الذي بنته الهجرات (`db:bootstrap` = baseline ثمّ `drizzle/sql`) يُقارَن
  بـ`schema.ts` — فلا تفترق هجرةٌ ومخطّطٌ بصمت. والمسموحُ بغيابه من `schema.ts`
  مسمّىً بسببه في `DB_ONLY` (`src/lib/ops/schema-drift.ts`).
*/
describe("schema.ts يطابق القاعدة التي بنتها الهجرات", () => {
  it("الجداول والأعمدة وأنواعها وقبولها الفراغ", async () => {
    const tables = (await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    `)).rows.map((r) => r.table_name);
    const columns = (await db.execute<InformationSchemaColumn>(sql`
      select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
             c.numeric_precision, c.numeric_scale
        from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    `)).rows;
    expect(tables.length).toBeGreaterThan(50);

    expect(schemaDrift(declaredShape(schema), actualShape(columns), tables)).toEqual([]);
  });
});
