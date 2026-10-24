import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { actualShape, declaredShape, normalizeActualType, normalizeDeclaredType, schemaDrift } from "./schema-drift";

const col = (table_name: string, column_name: string, data_type: string, nullable = true, udt_name = data_type, p: number | null = null, s: number | null = null) => ({
  table_name, column_name, data_type, udt_name, is_nullable: nullable ? "YES" : "NO", numeric_precision: p, numeric_scale: s,
});

describe("انحرافُ المخطّط — المقارنة نفسها", () => {
  it("يوحّد الأنواع من الطرفين", () => {
    expect(normalizeDeclaredType("timestamp")).toBe("timestamp without time zone");
    expect(normalizeDeclaredType("numeric(12, 3)")).toBe("numeric(12,3)");
    expect(normalizeActualType(col("t", "c", "numeric", true, "numeric", 12, 3))).toBe("numeric(12,3)");
    expect(normalizeActualType(col("t", "c", "ARRAY", true, "_text"))).toBe("text[]");
    expect(normalizeActualType(col("t", "c", "USER-DEFINED", true, "match_status"))).toBe("match_status");
  });

  it("يرى ما في schema.ts — المعدَّد باسمه، والمصفوفة، والمفتاح الأساسيّ إلزاميّاً", () => {
    const d = declaredShape(schema);
    expect(d.bank_transactions.match_status).toEqual({ type: "match_status", notNull: true });
    expect(d.adjudications.claimed_codes.type).toBe("text[]");
    expect(d.invoices.id.notNull).toBe(true);
    expect(d.invoices.subtotal_minor).toEqual({ type: "integer", notNull: false });
    expect(d.sales.business_date.type).toBe("date");
  });

  it("يقول كلَّ فرق، ويسكت عمّا سُمّي في القائمة", () => {
    const declared = { a: { id: { type: "text", notNull: true }, n: { type: "integer", notNull: false } }, only_here: { id: { type: "text", notNull: true } } };
    const actual = actualShape([
      col("a", "id", "text", false), col("a", "n", "integer", false),
      col("a", "legacy", "text"), col("a", "extra", "text"),
      col("schema_migrations", "name", "text", false),
      col("stray", "x", "text"),
    ]);
    const allow = { tables: { schema_migrations: "سجلّ" }, columns: { "a.legacy": "قديم" } };
    expect(schemaDrift(declared, actual, ["a", "schema_migrations", "stray"], allow)).toEqual([
      "قبولُ الفراغ مختلف: a.n — schema.ts يقبل الفراغ · القاعدة إلزاميّ",
      "عمودٌ في القاعدة وحدها: a.extra (text)",
      "جدولٌ في القاعدة وحدها: stray",
      "جدولٌ في schema.ts وحده — بلا هجرة: only_here",
    ]);
  });

  it("والمخطّطان المتّفقان بلا فرق", () => {
    const declared = { a: { id: { type: "text", notNull: true } } };
    expect(schemaDrift(declared, actualShape([col("a", "id", "text", false)]), ["a"])).toEqual([]);
  });
});
