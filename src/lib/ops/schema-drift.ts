/**
 * انحرافُ المخطّط: ما في القاعدة وما في `src/db/schema.ts` — يُقارَن ولا يُفترَض.
 *
 * الهجرةُ تُكتب بيدٍ في `drizzle/sql/` والمخطّطُ بيدٍ في `schema.ts`، ولا يربطهما
 * شيء. وقد افترقا فعلاً بصمت: `sales.business_date` و`recurring_expenses.starts_on`
 * عمودا `date` في القاعدة منذ ٠٠٥ وكانا `text` هنا. فالمقارنةُ تجري في
 * `test:db` على المخطّط الذي بنته الهجرات (`schema-drift.db.test.ts`): الجداول،
 * والأعمدة، وأنواعها، وقبولها الفراغ.
 *
 * وما يوجد في القاعدة وحدها عمداً يُسمّى في `DB_ONLY` بسببه — لا يُبتلَع.
 * والمؤثِّراتُ والدوالّ والفهارسُ والقيودُ خارج المقارنة أصلاً: ليست أعمدة،
 * ويثبتها `db:verify` بالرفض. ولا عمودَ مولَّداً (`GENERATED`) في القاعدة اليوم؛
 * فإن أُضيف ولم يُعرَّف هنا ظهر عموداً للقاعدة وحدها يُسمّى أو يُعرَّف.
 */
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";

export interface ColumnShape {
  /** النوعُ موحَّداً: `text` · `integer` · `timestamp with time zone` · `numeric(12,3)` · `text[]` · اسمُ النوع المعدَّد. */
  type: string;
  notNull: boolean;
}

/** جدولٌ ← عمودٌ ← شكله. */
export type SchemaShape = Record<string, Record<string, ColumnShape>>;

/** صفٌّ من `information_schema.columns`. */
export type InformationSchemaColumn = {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

/**
 * ما في القاعدة وحدها — بسببه. والإضافةُ هنا قرارٌ يُكتب له سطر، لا إسكاتٌ لفحص.
 */
export const DB_ONLY: { tables: Record<string, string>; columns: Record<string, string> } = {
  tables: {
    schema_migrations: "سجلُّ الهجرات المطبَّقة وبصماتها — يكتبه scripts/migrate.ts ولا يقرؤه التطبيق",
    tph_test_branch_marker: "علَمُ فرع الاختبار في Neon (بلا أعمدة) — src/test/branch-marker.ts",
  },
  columns: {
    /*
      أعمدةٌ قديمة لا يكتبها شيءٌ ولا يقرؤها: الفرعُ على الفاتورة والمصروف والصنف (011)
      صار من حساب البنك وجداوله، ومدّةُ الاستيراد نصّاً تُحسب اليوم من حركاته. وحذفُها
      على نشرتين، وقد تحمل بياناً — فلا يُحذف بلا قياسٍ وإذن.
    */
    "invoices.branch_id": "قديم (011) — لا يُكتب ولا يُقرأ",
    "expenses.branch_id": "قديم (011) — لا يُكتب ولا يُقرأ",
    "pos_products.branch_id": "قديم (011) — لا يُكتب ولا يُقرأ",
    "bank_imports.period_start": "قديم (011) — المدّة تُحسب من الحركات",
    "bank_imports.period_end": "قديم (011) — المدّة تُحسب من الحركات",
  },
};

/** نوعُ drizzle (`getSQLType()`) بصيغة القاعدة. */
export function normalizeDeclaredType(sqlType: string): string {
  const t = sqlType.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "timestamp") return "timestamp without time zone";
  if (t === "timestamptz") return "timestamp with time zone";
  const numeric = /^numeric\((\d+),\s*(\d+)\)$/.exec(t);
  if (numeric) return `numeric(${numeric[1]},${numeric[2]})`;
  return t;
}

/** نوعُ `information_schema` بالصيغة نفسها. */
export function normalizeActualType(c: Pick<InformationSchemaColumn, "data_type" | "udt_name" | "numeric_precision" | "numeric_scale">): string {
  const t = c.data_type.toLowerCase();
  if (t === "user-defined") return c.udt_name;
  if (t === "array") return `${c.udt_name.replace(/^_/, "")}[]`;
  if (t === "numeric" && c.numeric_precision !== null) return `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`;
  return t;
}

/** ما يعرّفه `schema.ts`: كلُّ `pgTable` مصدَّر — والمفتاحُ الأساسيّ إلزاميٌّ وإن لم يُكتب `notNull`. */
export function declaredShape(module: Record<string, unknown>): SchemaShape {
  const out: SchemaShape = {};
  for (const value of Object.values(module)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    const columns: Record<string, ColumnShape> = {};
    for (const c of config.columns) columns[c.name] = { type: normalizeDeclaredType(c.getSQLType()), notNull: c.notNull || c.primary };
    for (const pk of config.primaryKeys) for (const c of pk.columns) columns[c.name].notNull = true;
    out[config.name] = columns;
  }
  return out;
}

export function actualShape(rows: readonly InformationSchemaColumn[]): SchemaShape {
  const out: SchemaShape = {};
  for (const r of rows) {
    (out[r.table_name] ??= {})[r.column_name] = { type: normalizeActualType(r), notNull: r.is_nullable === "NO" };
  }
  return out;
}

/**
 * الفروقُ بنصٍّ يُقرأ — فارغةٌ حين يتّفق المخطّطان.
 *
 * والجدولُ الذي في القاعدة بلا أعمدة (العلَم) يُرى من قائمة الجداول لا الأعمدة،
 * فتُمرَّر أسماءُ الجداول وحدها في `actualTables`.
 */
export function schemaDrift(
  declared: SchemaShape,
  actual: SchemaShape,
  actualTables: readonly string[],
  allow: typeof DB_ONLY = DB_ONLY,
): string[] {
  const out: string[] = [];
  const tables = new Set([...actualTables, ...Object.keys(actual)]);

  for (const table of [...tables].sort()) {
    if (!declared[table]) {
      if (!allow.tables[table]) out.push(`جدولٌ في القاعدة وحدها: ${table}`);
      continue;
    }
    for (const [column, shape] of Object.entries(actual[table] ?? {})) {
      const mine = declared[table][column];
      if (!mine) {
        if (!allow.columns[`${table}.${column}`]) out.push(`عمودٌ في القاعدة وحدها: ${table}.${column} (${shape.type})`);
        continue;
      }
      if (mine.type !== shape.type) out.push(`نوعٌ مختلف: ${table}.${column} — schema.ts ${mine.type} · القاعدة ${shape.type}`);
      if (mine.notNull !== shape.notNull) {
        out.push(`قبولُ الفراغ مختلف: ${table}.${column} — schema.ts ${mine.notNull ? "إلزاميّ" : "يقبل الفراغ"} · القاعدة ${shape.notNull ? "إلزاميّ" : "يقبل الفراغ"}`);
      }
    }
  }

  for (const [table, columns] of Object.entries(declared).sort(([a], [b]) => a.localeCompare(b))) {
    if (!tables.has(table)) { out.push(`جدولٌ في schema.ts وحده — بلا هجرة: ${table}`); continue; }
    for (const column of Object.keys(columns)) {
      if (!actual[table]?.[column]) out.push(`عمودٌ في schema.ts وحده — بلا هجرة: ${table}.${column}`);
    }
  }
  return out;
}
