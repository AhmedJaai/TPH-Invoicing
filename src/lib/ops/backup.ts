/**
 * النسخة الاحتياطيّة: ماذا يُكتب، وبأيّ ترتيب — دوالُّ خالصة لا تتّصل بقاعدة.
 *
 * النسخة أربعة أقسام تُستعاد بترتيبها:
 *
 *   ١. `schema-pre-data.sql`  — الأنواع والدوالّ والجداول بلا قيود
 *   ٢. `data/<جدول>.json.gz`  — الصفوف
 *   ٣. `schema-post-data.sql` — القيود والفهارس والمؤثِّرات
 *   ٤. `manifest.json`        — عدد صفوف كلّ جدول وبصمة محتواه
 *
 * ── لماذا `check_function_bodies = off` في أوّل سطر ──
 *
 * `month_is_closed` دالّةٌ بلغة `sql` تقرأ `month_closes`، والدوالّ تُكتب
 * قبل الجداول لأنّ الأعمدة قد تحتاجها في قيمها الافتراضيّة. وPostgres يفحص
 * جسم دالّة `sql` عند إنشائها، فتسقط الاستعادة عند أوّل ملفّ بـ«relation
 * "month_closes" does not exist». وقد جُرّبت فسقطت. ومن يحاول الاستعادة
 * وقتَ الحادثة لا يجوز أن يكتشف ذلك حينها.
 *
 * ── لماذا القيود والمؤثِّرات بعد البيانات ──
 *
 * مؤثِّرُ الشهر المقفل (`028`) يرفض إدراج فاتورةٍ في شهرٍ مقفل — وهو صوابٌ
 * في العمل، وخطأٌ في الاستعادة: فواتير أغسطس المقفل حقيقيّةٌ وتجب عودتها.
 * والمفاتيح الأجنبيّة تفرض ترتيباً بين الجداول لا حاجة إليه. فالبيانات
 * تدخل جداولَ عارية، ثمّ تُبنى القيود فوقها فتفحصها كلّها مرّةً واحدة.
 *
 * ── ما لا يُنسَخ ──
 *
 * رموزُ جوجل في جدول `accounts` (رمز التجديد والوصول والهويّة) والجلسات: نسخةٌ تُحمَل على
 * قرصٍ أو تُرفع إلى تخزين تصير مفتاحاً إلى الدرايف لمن وجدها. وفقدُها في
 * الاستعادة يكلّف دخولاً واحداً بجوجل، وتسرّبُها يكلّف الأرشيف.
 */

export const BACKUP_SCHEMAS = ["public", "neon_auth"] as const;

/** ترتيب الأقسام — وهو ترتيب الاستعادة نفسه. */
export const BACKUP_SECTIONS = [
  "schema-pre-data.sql",
  "data",
  "schema-post-data.sql",
  "manifest.json",
] as const;

/** جداولُ يُنسَخ مخطّطها وحده — بياناتها أسرارٌ لا سجلّات. */
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  `"public"."sessions"`,
  `"public"."verification_tokens"`,
]);

/** أعمدةٌ تُكتب `null` في النسخة. */
export const EXCLUDED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  [`"public"."accounts"`]: ["refresh_token", "access_token", "id_token"],
};

export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
export const qualified = (sch: string, name: string) => `${ident(sch)}.${ident(name)}`;

export interface CatalogEnum { sch: string; name: string; labels: string[] }
export interface CatalogTable { sch: string; name: string }
export interface CatalogColumn { sch: string; tbl: string; col: string; typ: string; nn: boolean; def: string | null }
export interface CatalogConstraint { sch: string; tbl: string; name: string; kind: string; def: string }
export interface CatalogIndex { sch: string; name: string; def: string }
export interface CatalogFunction { sch: string; name: string; args: string; def: string }
export interface CatalogTrigger { sch: string; name: string; def: string }

export interface Catalog {
  enums: CatalogEnum[];
  tables: CatalogTable[];
  columns: CatalogColumn[];
  constraints: CatalogConstraint[];
  indexes: CatalogIndex[];
  functions: CatalogFunction[];
  triggers: CatalogTrigger[];
}

/**
 * استعلامات الفهرس. مرتَّبةٌ كلُّها، فالفهرسان المتطابقان يُنتجان نصّاً واحداً
 * وتُقارَن بصمتاهما. والمفاتيح الأجنبيّة آخرُ القيود: تحتاج مفاتيحَ أوّليّةً قائمة.
 */
export function catalogQueries(schemas: readonly string[] = BACKUP_SCHEMAS): Record<keyof Catalog, string> {
  const inList = schemas.map(lit).join(", ");
  return {
    enums: `select n.nspname::text sch, t.typname::text name, array_agg(e.enumlabel::text order by e.enumsortorder) labels
            from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
            where n.nspname in (${inList}) group by n.nspname, t.typname order by 1, 2`,
    tables: `select n.nspname::text sch, c.relname::text name from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname in (${inList}) and c.relkind in ('r', 'p') order by 1, 2`,
    columns: `select n.nspname::text sch, c.relname::text tbl, a.attname::text col, format_type(a.atttypid, a.atttypmod) typ,
                     a.attnotnull nn, pg_get_expr(d.adbin, d.adrelid) def
              from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
              left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
              where n.nspname in (${inList}) and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
              order by n.nspname, c.relname, a.attnum`,
    constraints: `select n.nspname::text sch, c.relname::text tbl, k.conname::text name, k.contype::text kind, pg_get_constraintdef(k.oid) def
                  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname in (${inList}) and k.contype in ('p', 'u', 'c', 'f', 'x')
                  order by (k.contype = 'f'), n.nspname, c.relname, k.conname`,
    indexes: `select schemaname::text sch, indexname::text name, indexdef def from pg_indexes i
              where schemaname in (${inList}) and not exists (
                select 1 from pg_constraint k where k.conindid = format('%I.%I', i.schemaname, i.indexname)::regclass)
              order by 1, 2`,
    functions: `select n.nspname::text sch, p.proname::text name, pg_get_function_identity_arguments(p.oid) args, pg_get_functiondef(p.oid) def
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname in (${inList}) and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
                order by 1, 2, 3`,
    triggers: `select n.nspname::text sch, t.tgname::text name, pg_get_triggerdef(t.oid) def
               from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
               where n.nspname in (${inList}) and not t.tgisinternal order by 1, 2`,
  };
}

/** السطر الأوّل من كلّ ملفّ مخطّطٍ قبل البيانات — انظر رأس الملفّ. */
export const PRE_DATA_PREAMBLE = "set check_function_bodies = off;";

/** يولّد نصَّي المخطّط: ما قبل البيانات وما بعدها. */
export function buildSchemaSql(cat: Catalog, schemas: readonly string[] = BACKUP_SCHEMAS): { pre: string; post: string } {
  const pre: string[] = [PRE_DATA_PREAMBLE];
  for (const s of schemas) if (s !== "public") pre.push(`create schema if not exists ${ident(s)};`);
  pre.push("create extension if not exists pgcrypto with schema public;");
  for (const e of cat.enums) pre.push(`create type ${qualified(e.sch, e.name)} as enum (${e.labels.map(lit).join(", ")});`);
  for (const f of cat.functions) pre.push(f.def.trim() + ";");
  for (const t of cat.tables) {
    const key = qualified(t.sch, t.name);
    const cols = cat.columns
      .filter((c) => qualified(c.sch, c.tbl) === key)
      .map((c) => `  ${ident(c.col)} ${c.typ}${c.def != null ? ` default ${c.def}` : ""}${c.nn ? " not null" : ""}`);
    pre.push(`create table ${key} (\n${cols.join(",\n")}\n);`);
  }

  const post: string[] = [];
  for (const k of cat.constraints) post.push(`alter table ${qualified(k.sch, k.tbl)} add constraint ${ident(k.name)} ${k.def};`);
  for (const i of cat.indexes) post.push(`${i.def};`);
  for (const tr of cat.triggers) post.push(`${tr.def};`);

  return { pre: pre.join("\n\n") + "\n", post: post.join("\n") + "\n" };
}

/**
 * التعبير الذي يُقرأ به الجدول — في النسخ وفي البصمة وفي التحقّق بعد الاستعادة.
 *
 * والتعبير واحدٌ في المواضع الثلاثة عمداً: بصمةٌ تُحسب على الجدول الخامّ
 * لا تطابق نسخةً أُسقطت منها الرموز أبداً، فيُقال «لم تطابق» عن نسخةٍ سليمة.
 */
export function tableSelect(table: string, columns: readonly string[]): string {
  const hidden = EXCLUDED_COLUMNS[table] ?? [];
  const list = columns.map((c) => (hidden.includes(c) ? `null::text as ${ident(c)}` : ident(c)));
  const where = EXCLUDED_TABLES.has(table) ? " where false" : "";
  return `select ${list.join(", ")} from ${table}${where}`;
}

/** عدد الصفوف وبصمة المحتوى، مستقلّةً عن ترتيب الصفوف في القرص. */
export function contentHashSql(table: string, columns: readonly string[]): string {
  return `select count(*)::int n, md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) h from (${tableSelect(table, columns)}) x`;
}

export interface ManifestTable { n: number; h: string; excluded?: "table" | "columns" }

export interface Manifest {
  takenAt: string;
  source: { database: string; systemIdentifier: string; serverVersion: string };
  sections: readonly string[];
  /** بصمة كلّ قسمٍ من الفهرس — فيُعرَف أيّها افترق لا أنّ شيئاً افترق. */
  schema: Record<keyof Catalog, string>;
  tables: Record<string, ManifestTable>;
  files: Record<string, string>;
}

export function exclusionOf(table: string): ManifestTable["excluded"] {
  if (EXCLUDED_TABLES.has(table)) return "table";
  if (EXCLUDED_COLUMNS[table]) return "columns";
  return undefined;
}

/** اسم ملفّ بيانات الجدول داخل `data/`. */
export const dataFileName = (table: string) => `${table.replace(/"/g, "")}.json.gz`;

export interface TableComparison { table: string; expected: ManifestTable; actual: { n: number; h: string } | null; ok: boolean }

/** يقارن ما استُعيد بما في البيان — جدولٌ غائب لا يُعدّ مطابقاً. */
export function compareTables(
  manifest: Pick<Manifest, "tables">,
  actual: Record<string, { n: number; h: string }>,
): TableComparison[] {
  return Object.entries(manifest.tables).map(([table, expected]) => {
    const got = actual[table] ?? null;
    return { table, expected, actual: got, ok: got !== null && got.n === expected.n && got.h === expected.h };
  });
}
