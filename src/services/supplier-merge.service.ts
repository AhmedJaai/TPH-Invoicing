/**
 * دمجُ مورّدٍ في آخر وتراجعُه، وحذفُ مورّدٍ بلا مال — فعلان للمالك (`supplier:merge`) من
 * صفحة المورّد (أحمد، ٢٤ أكتوبر ٢٠٢٦). كان الدمجُ نصّاً (`scripts/merge-suppliers.ts`) ينقل
 * خمسةَ جداول ويترك تسعة.
 *
 * ── الدمج ──
 * المعاينةُ من الخادم: ما ينتقل من كلّ جدول بعدده، وما يتعارض (رقمٌ ضريبيّ · آيبان)، و«عليك»
 * للطرفين قبل وبعد. والتأكيدُ معاملةٌ واحدة بمقبضها `t`: كلُّ `supplier_id` يُنقل، والاسمُ
 * البديل والصنفُ اللذان يحملهما الهدفُ أصلاً يُحذفان **بصفوفهما في سجلّ الدمج**، والمصدرُ
 * يبقى صفّاً شاهداً معطَّلاً (`merged_into_id`) — أسلمُ من حذفه: سجلُّ التدقيق والتنبيهاتُ
 * المحفوظة تشير إليه بمعرّفه، والتراجعُ يحتاجه. وشهرٌ مقفلٌ يمسّه الدمج يردّه بقائمة أشهره.
 *
 * ── التراجع ──
 * ما نُقل يُعاد إلى المصدر بمعرّفاته، وما حُذف يُعاد بصفّه، وما نُسخ يُعاد. وما أُضيف إلى
 * الهدف بعد الدمج يبقى للهدف — لا يُعرف أكان للمصدر.
 *
 * ── الحذف ──
 * لا يُحذف مورّدٌ عليه مال (فواتير · دفعات · كشوف · حركات بنك · استلاماتٌ بتكلفة). وما سوى
 * ذلك يُقال قبل التأكيد ثمّ يُفكّ: المستنداتُ بلا مورّد، والأسماءُ البديلة والأصنافُ تُحذف،
 * والجهاتُ في كشف البنك تعود «غير مصنّفة» فتُسأل من جديد، وقواعدُ التصنيف باسمه تُحذف.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { recordAudit } from "@/lib/audit";
import { formatMonth } from "@/lib/riyadh-time";
import { supplierMerges } from "@/db/schema";
import {
  deleteBlockers, duplicateHints, mergeConflicts, mergedBalance, MERGE_TABLES,
  type DeletePreview, type DuplicateHint, type MergePreview, type MergeTable, type MoneyCounts,
} from "@/lib/supplier-merge";
import type { SupplierBalance } from "@/lib/supplier-balances";
import { loadSupplierBalances } from "./supplier-balance.service";
import { assertMonthsOpen, closedMonthsAmong } from "./month-guard";
import type { Tx } from "./types";

type Conn = typeof db | Tx;

/** رفضٌ يُقال لصاحبه بنصّه (٤٠٩) — لا شيء كُتب. */
export class SupplierMergeRefused extends Error {
  readonly months: string[];
  constructor(message: string, months: string[] = []) {
    super(message);
    this.name = "SupplierMergeRefused";
    this.months = months;
  }
}

type SupplierRow = {
  id: string;
  slug: string;
  name_ar: string;
  vat_number: string | null;
  iban: string | null;
  is_active: boolean;
  issues_invoices: boolean;
  merged_into_id: string | null;
};

async function supplierRow(conn: Conn, id: string, lock = false): Promise<SupplierRow | null> {
  const { rows } = await conn.execute<SupplierRow>(sql`
    select id, slug, name_ar, vat_number, iban, is_active, issues_invoices, merged_into_id
      from suppliers where id = ${id} ${lock ? sql`for update` : sql``}
  `);
  return rows[0] ?? null;
}

/** معرّفاتُ ما يشير إلى المورّد في كلّ جدول — بأسمائها من قائمةٍ مغلقة لا من الطلب. */
async function idsPointingTo(conn: Conn, supplierId: string): Promise<Record<MergeTable, string[]>> {
  const out = {} as Record<MergeTable, string[]>;
  for (const table of MERGE_TABLES) {
    const { rows } = await conn.execute<{ id: string }>(
      sql`select id from ${sql.identifier(table)} where supplier_id = ${supplierId} order by id`,
    );
    out[table] = rows.map((r) => r.id);
  }
  return out;
}

/** الأشهرُ التي تمسّها حركةُ المورّد — بالتعريف نفسه الذي يقفل به مؤثِّرُ الشهر. */
async function monthsOf(conn: Conn, supplierId: string): Promise<string[]> {
  const { rows } = await conn.execute<{ m: string }>(sql`
    select distinct m from (
      select period_month as m from invoices where supplier_id = ${supplierId}
      union select payment_month(applies_to_month, paid_at) from payments where supplier_id = ${supplierId}
      union select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') from bank_transactions where supplier_id = ${supplierId}
      union select to_char(period_end at time zone 'Asia/Riyadh', 'YYYY-MM') from statements where supplier_id = ${supplierId}
    ) x where m is not null order by m
  `);
  return rows.map((r) => r.m);
}

async function balanceOf(conn: Conn, supplierId: string): Promise<SupplierBalance | undefined> {
  return (await loadSupplierBalances(conn, supplierId))[0];
}

/* ─────────────────────────── المعاينة ─────────────────────────── */

export async function previewMerge(sourceId: string, targetId: string, conn: Conn = db): Promise<MergePreview> {
  const [source, target] = await Promise.all([supplierRow(conn, sourceId), supplierRow(conn, targetId)]);
  if (!source || !target) throw new SupplierMergeRefused("المورّد غير موجود. حدّث الصفحة.");
  const refused = sourceId === targetId ? "لا يُدمج المورّد في نفسه."
    : source.merged_into_id ? "هذا المورّد دُمج من قبل."
      : target.merged_into_id ? "المورّد الهدف دُمج في غيره. ادمج في الباقي منهما."
        : null;

  const [ids, months, sb, tb, dup] = await Promise.all([
    idsPointingTo(conn, sourceId),
    monthsOf(conn, sourceId),
    balanceOf(conn, sourceId),
    balanceOf(conn, targetId),
    conn.execute<{ aliases: number; products: number; item_aliases: number }>(sql`
      select
        (select count(*)::int from supplier_aliases a where a.supplier_id = ${sourceId}
          and exists (select 1 from supplier_aliases b where b.supplier_id = ${targetId} and b.normalized = a.normalized and b.kind = a.kind)) as aliases,
        (select count(*)::int from supplier_products a where a.supplier_id = ${sourceId}
          and exists (select 1 from supplier_products b where b.supplier_id = ${targetId} and b.normalized_description = a.normalized_description)) as products,
        (select count(*)::int from supplier_item_aliases a where a.supplier_id = ${sourceId}
          and exists (select 1 from supplier_item_aliases b where b.supplier_id = ${targetId} and b.alias_normalized = a.alias_normalized)) as item_aliases
    `),
  ]);
  const closed = [...await closedMonthsAmong(conn, months)].sort();
  const { conflicts, copy } = mergeConflicts(
    { vatNumber: source.vat_number, iban: source.iban },
    { vatNumber: target.vat_number, iban: target.iban },
  );
  const after = mergedBalance(sb, tb, target.issues_invoices);
  const d = dup.rows[0];
  const counts = Object.fromEntries(MERGE_TABLES.map((t) => [t, ids[t].length])) as Record<MergeTable, number>;
  return {
    source: { id: source.id, slug: source.slug, name: source.name_ar },
    target: { id: target.id, slug: target.slug, name: target.name_ar },
    counts,
    duplicates: { aliases: Number(d?.aliases ?? 0), products: Number(d?.products ?? 0), itemAliases: Number(d?.item_aliases ?? 0) },
    conflicts,
    copies: copy,
    balance: { source: sb?.owedMinor ?? 0, target: tb?.owedMinor ?? 0, after: after.owedMinor, creditAfter: after.creditLeftMinor },
    closedMonths: closed,
    refused,
  };
}

/* ─────────────────────────── الدمج ─────────────────────────── */

const closedMessage = (months: readonly string[]) =>
  `الدمج يمسّ ${months.length === 1 ? "شهراً مقفلاً" : "أشهراً مقفلة"}: ${months.map(formatMonth).join("، ")}. أعد فتحها من صفحة الإقفال ثم ادمج، أو اترك المورّدين كما هما.`;

export async function mergeSuppliers(
  sourceId: string, targetId: string, actorId: string, conn: Conn = db,
): Promise<{ mergeId: string; moved: Record<MergeTable, number> }> {
  return conn.transaction(async (t) => {
    /* القفلُ بترتيبٍ ثابت — دمجان متعاكسان لا يتعانقان */
    for (const id of [sourceId, targetId].sort()) await supplierRow(t, id, true);
    const preview = await previewMerge(sourceId, targetId, t);
    if (preview.refused) throw new SupplierMergeRefused(preview.refused);
    if (preview.closedMonths.length > 0) throw new SupplierMergeRefused(closedMessage(preview.closedMonths), preview.closedMonths);
    /* وقفلٌ مشترك على أشهرها حتى آخر المعاملة — إقفالٌ يبدأ الآن ينتظرها */
    await assertMonthsOpen(t, await monthsOf(t, sourceId));

    const removedAliases = (await t.execute(sql`
      delete from supplier_aliases a where a.supplier_id = ${sourceId}
        and exists (select 1 from supplier_aliases b where b.supplier_id = ${targetId} and b.normalized = a.normalized and b.kind = a.kind)
      returning a.*
    `)).rows;
    const removedItemAliases = (await t.execute(sql`
      delete from supplier_item_aliases a where a.supplier_id = ${sourceId}
        and exists (select 1 from supplier_item_aliases b where b.supplier_id = ${targetId} and b.alias_normalized = a.alias_normalized)
      returning a.*
    `)).rows;

    /* الصنفُ بالوصف نفسه عند الهدف: بنودُه تُنسب إلى صنف الهدف، ثمّ يُحذف صنفُ المصدر */
    const pairs = (await t.execute<{ source_product: string; target_product: string }>(sql`
      select a.id as source_product, b.id as target_product
        from supplier_products a join supplier_products b
          on b.supplier_id = ${targetId} and b.normalized_description = a.normalized_description
       where a.supplier_id = ${sourceId}
    `)).rows;
    const repointedLines: { lineId: string; from: string }[] = [];
    for (const p of pairs) {
      const lines = (await t.execute<{ id: string }>(sql`
        update invoice_lines set supplier_product_id = ${p.target_product}
         where supplier_product_id = ${p.source_product} returning id
      `)).rows;
      for (const l of lines) repointedLines.push({ lineId: l.id, from: p.source_product });
    }
    const removedProducts = pairs.length === 0 ? [] : (await t.execute(sql`
      delete from supplier_products where id in (${sql.join(pairs.map((p) => sql`${p.source_product}`), sql`, `)}) returning *
    `)).rows;

    /* ما بقي يُنقل كلُّه، بمعرّفاته */
    const moved = await idsPointingTo(t, sourceId);
    for (const table of MERGE_TABLES) {
      if (moved[table].length === 0) continue;
      await t.execute(sql`update ${sql.identifier(table)} set supplier_id = ${targetId} where supplier_id = ${sourceId}`);
    }

    /* الرقمُ الضريبيّ فريد: يُرفع عن المصدر قبل أن يُكتب للهدف */
    const copied = preview.copies;
    if (copied.vatNumber) {
      await t.execute(sql`update suppliers set vat_number = null where id = ${sourceId}`);
      await t.execute(sql`update suppliers set vat_number = ${copied.vatNumber}, updated_at = now() where id = ${targetId}`);
    }
    if (copied.iban) {
      await t.execute(sql`update suppliers set iban = ${copied.iban}, iban_set_at = now(), iban_set_by_id = ${actorId}, updated_at = now() where id = ${targetId}`);
    }

    await t.execute(sql`
      update suppliers set is_active = false, merged_into_id = ${targetId}, merged_at = now(), merged_by_id = ${actorId}, updated_at = now()
       where id = ${sourceId}
    `);

    const [row] = await t.insert(supplierMerges).values({
      sourceId, targetId,
      moved,
      removed: { aliases: removedAliases, itemAliases: removedItemAliases, products: removedProducts, repointedLines },
      copied,
      mergedById: actorId,
    }).returning({ id: supplierMerges.id });

    const movedCounts = Object.fromEntries(MERGE_TABLES.map((x) => [x, moved[x].length])) as Record<MergeTable, number>;
    await recordAudit({
      actorId,
      action: "SUPPLIER_MERGED",
      entityType: "supplier",
      entityId: sourceId,
      before: {
        "المدموج": `${preview.source.name} (${preview.source.slug})`,
        "الباقي": `${preview.target.name} (${preview.target.slug})`,
        "عليك للمدموج بالهللات": preview.balance.source,
        "عليك للباقي بالهللات": preview.balance.target,
      },
      after: {
        "سجل الدمج": row.id,
        "عليك بعد الدمج بالهللات": preview.balance.after,
        "ما نُقل": movedCounts,
        "المعرّفات المنقولة": moved,
        "حُذف لأنّ الباقي يحمله": { "أسماء بديلة": removedAliases.length, "أصناف": removedProducts.length, "صيغ أصناف": removedItemAliases.length },
        "نُسخ إلى الباقي": copied,
        "تعارضات قيلت قبل التأكيد": preview.conflicts.map((c) => c.field),
      },
    }, t);

    return { mergeId: row.id, moved: movedCounts };
  });
}

/* ─────────────────────────── التراجع ─────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const asRows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : []);

/** يُعيد صفّاً محذوفاً كما كان — بأعمدته من سجلّ الدمج، والقاعدةُ تحكم أنواعها (`json_populate_record`) */
async function reinsert(t: Tx, table: string, row: Record<string, unknown>): Promise<void> {
  if (Object.keys(row).length === 0) return;
  await t.execute(sql`
    insert into ${sql.identifier(table)}
    select * from json_populate_record(null::${sql.identifier(table)}, ${JSON.stringify(row)}::json)
    on conflict do nothing
  `);
}

export async function undoMerge(sourceId: string, actorId: string, conn: Conn = db): Promise<{ restored: number }> {
  return conn.transaction(async (t) => {
    const { rows } = await t.execute<{ id: string; target_id: string; moved: unknown; removed: unknown; copied: unknown }>(sql`
      select id, target_id, moved, removed, copied from supplier_merges
       where source_id = ${sourceId} and undone_at is null order by merged_at desc limit 1 for update
    `);
    const m = rows[0];
    if (!m) throw new SupplierMergeRefused("لا دمج قائم لهذا المورّد يُتراجع عنه.");
    const targetId = m.target_id;
    for (const id of [sourceId, targetId].sort()) await supplierRow(t, id, true);

    const moved = isRecord(m.moved) ? m.moved : {};
    /* أشهرُ ما يعود — والمقفلُ منها يردّ التراجع كما يردّ الدمج */
    const invoiceIds = asIds(moved.invoices), paymentIds = asIds(moved.payments), txIds = asIds(moved.bank_transactions), stIds = asIds(moved.statements);
    const inList = (ids: string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
    const monthRows = (await t.execute<{ m: string }>(sql`
      select distinct m from (
        ${invoiceIds.length ? sql`select period_month as m from invoices where id in (${inList(invoiceIds)})` : sql`select null::text as m`}
        union ${paymentIds.length ? sql`select payment_month(applies_to_month, paid_at) from payments where id in (${inList(paymentIds)})` : sql`select null::text`}
        union ${txIds.length ? sql`select to_char(value_date at time zone 'Asia/Riyadh', 'YYYY-MM') from bank_transactions where id in (${inList(txIds)})` : sql`select null::text`}
        union ${stIds.length ? sql`select to_char(period_end at time zone 'Asia/Riyadh', 'YYYY-MM') from statements where id in (${inList(stIds)})` : sql`select null::text`}
      ) x where m is not null
    `)).rows.map((r) => r.m);
    const closed = [...await closedMonthsAmong(t, monthRows)].sort();
    if (closed.length > 0) throw new SupplierMergeRefused(closedMessage(closed).replace("الدمج", "التراجع"), closed);
    await assertMonthsOpen(t, monthRows);

    let restored = 0;
    for (const table of MERGE_TABLES) {
      const ids = asIds(moved[table]);
      if (ids.length === 0) continue;
      /* ما زال عند الهدف وحده يعود — ما نُقل بعدُ إلى غيره يبقى حيث هو */
      const r = await t.execute(sql`
        update ${sql.identifier(table)} set supplier_id = ${sourceId}
         where supplier_id = ${targetId} and id in (${inList(ids)})
      `);
      restored += r.rowCount ?? 0;
    }

    const removed = isRecord(m.removed) ? m.removed : {};
    for (const row of asRows(removed.aliases)) await reinsert(t, "supplier_aliases", row);
    for (const row of asRows(removed.itemAliases)) await reinsert(t, "supplier_item_aliases", row);
    for (const row of asRows(removed.products)) await reinsert(t, "supplier_products", row);
    for (const l of asRows(removed.repointedLines)) {
      if (typeof l.lineId === "string" && typeof l.from === "string") {
        await t.execute(sql`update invoice_lines set supplier_product_id = ${l.from} where id = ${l.lineId}`);
      }
    }

    const copied = isRecord(m.copied) ? m.copied : {};
    if (typeof copied.vatNumber === "string") {
      await t.execute(sql`update suppliers set vat_number = null where id = ${targetId} and vat_number = ${copied.vatNumber}`);
      await t.execute(sql`update suppliers set vat_number = ${copied.vatNumber} where id = ${sourceId}`);
    }
    if (typeof copied.iban === "string") {
      await t.execute(sql`update suppliers set iban = null, iban_set_at = null, iban_set_by_id = null where id = ${targetId} and iban = ${copied.iban}`);
    }

    await t.execute(sql`
      update suppliers set is_active = true, merged_into_id = null, merged_at = null, merged_by_id = null, updated_at = now()
       where id = ${sourceId}
    `);
    await t.execute(sql`update supplier_merges set undone_at = now(), undone_by_id = ${actorId} where id = ${m.id}`);
    await recordAudit({
      actorId,
      action: "SUPPLIER_MERGE_UNDONE",
      entityType: "supplier",
      entityId: sourceId,
      after: { "سجل الدمج": m.id, "صفوف أعيدت": restored },
    }, t);
    return { restored };
  });
}

/* ─────────────────────────── الحذف ─────────────────────────── */

export async function previewDelete(supplierId: string, conn: Conn = db): Promise<DeletePreview> {
  const s = await supplierRow(conn, supplierId);
  if (!s) throw new SupplierMergeRefused("المورّد غير موجود. حدّث الصفحة.");
  const { rows } = await conn.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from invoices where supplier_id = ${supplierId}) as invoices,
      (select count(*)::int from payments where supplier_id = ${supplierId}) as payments,
      (select count(*)::int from statements where supplier_id = ${supplierId}) as statements,
      (select count(*)::int from bank_transactions where supplier_id = ${supplierId}) as bank_transactions,
      (select count(*)::int from inventory_receipts where supplier_id = ${supplierId}) as inventory_receipts,
      (select count(*)::int from invoice_lines where supplier_id = ${supplierId}) as invoice_lines,
      (select count(*)::int from documents where supplier_id = ${supplierId}) as documents,
      (select count(*)::int from supplier_aliases where supplier_id = ${supplierId}) as aliases,
      (select count(*)::int from supplier_products where supplier_id = ${supplierId}) as products,
      (select count(*)::int from supplier_item_aliases where supplier_id = ${supplierId}) as item_aliases,
      (select count(*)::int from counterparties where supplier_id = ${supplierId}) as counterparties,
      (select count(*)::int from bank_rules where supplier_id = ${supplierId}) as rules,
      (select count(*)::int from foodics_suppliers where supplier_id = ${supplierId}) as foodics,
      (select count(*)::int from ai_findings where supplier_id = ${supplierId}) as findings,
      (select count(*)::int from suppliers where merged_into_id = ${supplierId}) as merged_in,
      (select count(*)::int from supplier_merges where source_id = ${supplierId} or target_id = ${supplierId}) as merge_history
  `);
  const c = rows[0] ?? {};
  const n = (k: string) => Number(c[k] ?? 0);
  const money: MoneyCounts = {
    /* بنودٌ بلا فاتورة لا تقع، ولو وقعت فهي مالٌ مقيَّد كالفاتورة */
    invoices: n("invoices") + (n("invoices") === 0 ? n("invoice_lines") : 0),
    payments: n("payments"),
    statements: n("statements"),
    bankTransactions: n("bank_transactions"),
    inventoryReceipts: n("inventory_receipts"),
  };
  const blockers = deleteBlockers(money);
  return {
    supplier: { id: s.id, slug: s.slug, name: s.name_ar },
    money,
    blockers,
    detach: {
      documents: n("documents"), aliases: n("aliases"), products: n("products"), itemAliases: n("item_aliases"),
      counterparties: n("counterparties"), rules: n("rules"), foodics: n("foodics"), findings: n("findings"),
    },
    refused: blockers.length > 0
      ? `عليه مال مقيَّد: ${blockers.map((b) => `${b.count} ${b.label}`).join("، ")}. ادمجه في مورّد آخر بدلاً من حذفه.`
      : n("merged_in") > 0 ? "دُمج فيه مورّد آخر، وحذفه يقطع التراجع عن ذلك الدمج."
        : n("merge_history") > 0 ? "له سجل دمج سابق يُقرأ به ما انتقل، فلا يُحذف." : null,
  };
}

export async function deleteSupplier(supplierId: string, actorId: string, conn: Conn = db): Promise<DeletePreview["detach"]> {
  return conn.transaction(async (t) => {
    await supplierRow(t, supplierId, true);
    /* الفحصُ نفسُه داخل المعاملة وعلى الصفّ المقفول — لا ما رآه المتصفّح */
    const p = await previewDelete(supplierId, t);
    if (p.refused) throw new SupplierMergeRefused(p.refused);

    const docs = (await t.execute<{ id: string }>(sql`update documents set supplier_id = null where supplier_id = ${supplierId} returning id`)).rows.map((r) => r.id);
    const aliases = (await t.execute(sql`delete from supplier_aliases where supplier_id = ${supplierId} returning *`)).rows;
    const itemAliases = (await t.execute(sql`delete from supplier_item_aliases where supplier_id = ${supplierId} returning id`)).rows.length;
    const products = (await t.execute(sql`delete from supplier_products where supplier_id = ${supplierId} returning *`)).rows;
    /* الجهةُ في الكشف بابُها «سداد مورّد» لمورّدٍ لم يعد — تعود «غير مصنّفة» فتُسأل من جديد */
    const parties = (await t.execute<{ id: string; kind: string }>(sql`
      update counterparties set supplier_id = null, kind = case when kind = 'SUPPLIER' then 'UNKNOWN'::tx_category else kind end, updated_at = now()
       where supplier_id = ${supplierId} returning id, kind::text as kind
    `)).rows;
    const rules = (await t.execute(sql`delete from bank_rules where supplier_id = ${supplierId} returning *`)).rows;
    const foodics = (await t.execute<{ id: string }>(sql`update foodics_suppliers set supplier_id = null where supplier_id = ${supplierId} returning id`)).rows.length;
    const findings = (await t.execute(sql`delete from ai_findings where supplier_id = ${supplierId} returning id`)).rows.length;
    const [gone] = (await t.execute(sql`delete from suppliers where id = ${supplierId} returning *`)).rows;

    await recordAudit({
      actorId,
      action: "SUPPLIER_DELETED",
      entityType: "supplier",
      entityId: supplierId,
      before: { "المورّد": gone, "أسماء بديلة": aliases, "أصناف": products, "قواعد تصنيف": rules },
      after: {
        "مستندات صارت بلا مورّد": docs,
        "جهات في الكشف فُكّت عنه": parties.map((x) => x.id),
        "صيغ أصناف حُذفت": itemAliases,
        "ملاحظات تحليل حُذفت": findings,
        "مورّدو فودكس فُكّوا": foodics,
      },
    }, t);
    return {
      documents: docs.length, aliases: aliases.length, products: products.length, itemAliases,
      counterparties: parties.length, rules: rules.length, foodics, findings,
    };
  });
}

/* ─────────────── مورّدون قد يكونون واحداً — للقراءة ─────────────── */

/** المورّدون القائمون (غيرُ المدموجين) بما يُعرَف به التكرار — والتلميحُ لا يدمج شيئاً. */
export async function loadDuplicateHints(conn: Conn = db): Promise<DuplicateHint[]> {
  const { rows } = await conn.execute<{ id: string; slug: string; name_ar: string; name_en: string | null; vat_number: string | null; iban: string | null }>(sql`
    select id, slug, name_ar, name_en, vat_number, iban from suppliers
     where is_active and merged_into_id is null
  `);
  return duplicateHints(rows.map((r) => ({ id: r.id, slug: r.slug, nameAr: r.name_ar, nameEn: r.name_en, vatNumber: r.vat_number, iban: r.iban })));
}
