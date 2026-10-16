/**
 * ربطُ بنود الفواتير بأصناف المخزون — كلُّ ما اشتُري يوماً، مرتَّباً بقيمته، ومعه اقتراحُه.
 *
 * تقريرُ «المشترى مقابل المباع» يحسب مشترياتِ الصنف من بنود فواتيرنا **المربوطة** به.
 * وقيس على الإنتاج (١٢ أكتوبر ٢٠٢٦): المربوطُ معروفُ العبوة ٢٪ من قيمة المشتريات في مايو
 * و٦١٪ في أكتوبر — فأوّلُ العمل رفعُ التغطية. والاقتراحُ من دليلين:
 *   ١. **فودكس**: بندُ شراءٍ للمورّد نفسه في الأيّام نفسها بالمبلغ نفسه (`link-evidence.ts`).
 *   ٢. **الاسم**: أقربُ أصناف الجرد وعبوةٌ من نصّ البند (`purchase-link.ts`) — تلميح.
 * ولا يُكتب ربطٌ إلّا بضغطة: الكتابةُ بـ`savePurchaseLink` نفسِها.
 *
 * و«ليس مخزوناً» قرارٌ في `alert_resolutions` (`stock-link:sp-…`): معدّاتٌ وخدماتٌ تخرج
 * من مقام التغطية ولا تُسأل ثانيةً.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { summariseEvidence, type EvidenceMatch, type LinkEvidence } from "@/lib/finance/link-evidence";
import { guessPackSpec, suggestStockItem, type PackGuess } from "@/lib/inventory/purchase-link";
import { decimalToMilli, sameUnitFamily } from "@/lib/inventory/units";
import { silencedKeys } from "@/lib/signal-decisions";
import { todayInRiyadh } from "@/lib/riyadh-time";
import { isStoredUnit } from "@/lib/unit-conversion";
import { loadStockItemOptions, PurchaseLinkRefused, savePurchaseLink, type PurchaseLinkRow, type StockItemOption } from "./inventory-purchase-link.service";
import type { Conn } from "./types";

export const notStockKey = (supplierProductId: string) => `stock-link:sp-${supplierProductId}`;

/** أيّامُ السماحة بين تاريخ فاتورتنا ويوم إدخالها في فودكس، وهللاتُ السماحة في المبلغ. */
const EVIDENCE_DAYS = 3;
const EVIDENCE_AMOUNT_MINOR = 100;

export interface StockLinkRow extends PurchaseLinkRow {
  /** ما اشتُري من هذا البند كلَّ الوقت — به يُرتَّب العمل. */
  valueMinor: number;
  lastDay: string | null;
  evidence: (LinkEvidence & { productName: string }) | null;
  notStock: boolean;
}

export interface StockLinks {
  rows: StockLinkRow[];
  options: StockItemOption[];
  /** قيمةُ ما اشتُري: الكلّ · ما يدخل الحساب · ما قيل إنّه ليس مخزوناً. */
  totalMinor: number;
  measuredMinor: number;
  notStockMinor: number;
  /** ما يُقرّ بضغطةٍ واحدة: دليلُ فودكس اتّفق على الصنف والعبوة بشاهدَين فأكثر. */
  readyCount: number;
  readyMinor: number;
}

/** شاهدان فأكثر — واحدٌ قد يكون مصادفةَ مبلغ. */
export const READY_MIN_MATCHES = 2;

async function loadEvidence(conn: Conn): Promise<Map<string, LinkEvidence>> {
  const rows = await conn.execute<{ sp: string; product_id: string; base_unit: string; qty: string | null; fq: string; pack_milli: string | null }>(sql`
    select il.supplier_product_id as sp, p.id as product_id, p.base_unit::text as base_unit,
           il.qty::text as qty, fi.quantity_milli::text as fq, p.catalog_pack_milli::text as pack_milli
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      join foodics_suppliers fs on fs.supplier_id = i.supplier_id
      join foodics_purchases fp on fp.foodics_supplier_id = fs.id and fp.type = 1
       and abs(fp.business_date::date - (i.invoice_date at time zone 'Asia/Riyadh')::date) <= ${EVIDENCE_DAYS}
      join foodics_purchase_items fi on fi.purchase_id = fp.id
       and abs(fi.cost_minor - il.line_total_minor) <= ${EVIDENCE_AMOUNT_MINOR}
      join products p on p.foodics_item_sku = fi.sku and p.is_stock_item
     where il.supplier_product_id is not null and il.line_total_minor > 0
  `);
  const matches: EvidenceMatch[] = rows.rows.flatMap((r) => {
    if (!isStoredUnit(r.base_unit) || r.pack_milli === null) return [];
    return [{
      supplierProductId: r.sp, productId: r.product_id, baseUnit: r.base_unit,
      invoiceQtyMilli: decimalToMilli(r.qty),
      /* مِلّي‑وحدةِ‑تخزين × عبوةُ الكتالوج ÷ ألف = مِلّي وحدةِ الأساس */
      foodicsBaseMilli: Math.round((Number(r.fq) * Number(r.pack_milli)) / 1000),
    }];
  });
  return summariseEvidence(matches);
}

const plain = (d: string) => (d.includes(".") ? d.replace(/\.?0+$/, "") : d);

export async function loadStockLinks(conn: Conn = db): Promise<StockLinks> {
  const [options, evidence, rows, decisions] = await Promise.all([
    loadStockItemOptions(conn),
    loadEvidence(conn),
    conn.execute<{
      sp_id: string; supplier_name: string; display_name: string; product_id: string | null; product_name: string | null; is_stock: boolean | null;
      pack_size: string | null; content_quantity: string | null; content_unit: string | null;
      lines: number; value: string; last_day: string | null; invoice_numbers: string[] | null; qty: string | null; qty_unknown: number;
    }>(sql`
      select sp.id as sp_id, su.name_ar as supplier_name, sp.display_name, sp.product_id, p.name_ar as product_name, p.is_stock_item as is_stock,
             sp.pack_size::text, sp.content_quantity::text, sp.content_unit::text,
             count(il.id)::int as lines, coalesce(sum(il.line_total_minor), 0)::bigint as value,
             max(to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) as last_day,
             (array_agg(distinct i.invoice_number))[1:4] as invoice_numbers,
             sum(il.qty)::text as qty, count(*) filter (where il.qty is null)::int as qty_unknown
        from supplier_products sp
        join suppliers su on su.id = sp.supplier_id
        join invoice_lines il on il.supplier_product_id = sp.id
        join invoices i on i.id = il.invoice_id and i.is_fixed_asset = false
        left join products p on p.id = sp.product_id
       group by sp.id, su.name_ar, p.name_ar, p.is_stock_item
       order by value desc
    `),
    conn.execute<{ key: string; decision: string }>(sql`select key, decision from alert_resolutions where key like 'stock-link:%'`),
  ]);
  const silenced = silencedKeys(decisions.rows, todayInRiyadh());
  const byId = new Map(options.map((o) => [o.id, o]));

  const out: StockLinkRow[] = rows.rows.map((r) => {
    const contentUnit = r.content_unit && isStoredUnit(r.content_unit) ? r.content_unit : null;
    const pack: PackGuess | null = r.pack_size && r.content_quantity && contentUnit
      ? { packSize: plain(r.pack_size), contentQuantity: plain(r.content_quantity), contentUnit } : null;
    const product = r.product_id ? byId.get(r.product_id) : undefined;
    const packFits = Boolean(product && pack && sameUnitFamily(pack.contentUnit, product.baseUnit));
    /* صنفٌ ليس مخزوناً (رُبط بصنفٍ خارج الجرد) أو أقرّ صاحبُه أنّه ليس مخزوناً */
    const notStock = silenced.has(notStockKey(r.sp_id)) || (r.product_id !== null && r.is_stock === false);
    const ev = evidence.get(r.sp_id) ?? null;
    const evProduct = ev ? byId.get(ev.productId) : undefined;
    const nameGuess = product ? null : suggestStockItem(r.display_name, options);
    const textPack = guessPackSpec(r.display_name);
    const target = product ?? evProduct ?? nameGuess ?? null;
    const evidencePack: PackGuess | null = ev && ev.contentQuantity !== null ? { packSize: "1", contentQuantity: ev.contentQuantity, contentUnit: ev.baseUnit } : null;
    const status: StockLinkRow["status"] = !product ? "UNLINKED_PRODUCT" : !pack ? "NO_PACK_SPEC" : !packFits ? "UNIT_FAMILY_MISMATCH" : r.qty_unknown > 0 ? "MISSING_QUANTITY" : "LINKED";
    return {
      supplierProductId: r.sp_id, supplierName: r.supplier_name, displayName: r.display_name,
      productId: product?.id ?? null, productName: product?.nameAr ?? r.product_name,
      pack,
      suggestedProductId: product ? null : (evProduct ?? nameGuess)?.id ?? null,
      /* عبوةُ دليل فودكس تغلب تخمينَ النصّ؛ وتخمينُ النصّ لا يُعرَض إن خالف عائلةَ الصنف */
      guessedPack: pack ? null : evidencePack ?? (textPack && (!target || sameUnitFamily(textPack.contentUnit, target.baseUnit)) ? textPack : null),
      lines: r.lines, invoiceNumbers: r.invoice_numbers ?? [],
      qtyText: r.qty_unknown > 0 || r.qty === null ? "غير معروفة في بعضها" : plain(r.qty),
      status,
      statusLabel: status === "LINKED" ? null
        : status === "UNLINKED_PRODUCT" ? "لم يربط بصنف مخزون"
        : status === "NO_PACK_SPEC" ? "ربط ولم يكتب ما في الوحدة"
        : status === "UNIT_FAMILY_MISMATCH" ? "وحدة العبوة لا تحوّل إلى وحدة الصنف"
        : "كمّيّة غير مقروءة في بعض فواتيره",
      countedText: null,
      valueMinor: Number(r.value), lastDay: r.last_day,
      evidence: ev && evProduct ? { ...ev, productName: evProduct.nameAr } : null,
      notStock,
    };
  });

  const ready = out.filter(isReady);
  return {
    rows: out, options,
    totalMinor: out.reduce((s, r) => s + r.valueMinor, 0),
    measuredMinor: out.filter((r) => r.status === "LINKED" && !r.notStock).reduce((s, r) => s + r.valueMinor, 0),
    notStockMinor: out.filter((r) => r.notStock).reduce((s, r) => s + r.valueMinor, 0),
    readyCount: ready.length, readyMinor: ready.reduce((s, r) => s + r.valueMinor, 0),
  };
}

/** يُقرّ بضغطة: لم يُربَط، ودليلُ فودكس اتّفق على صنفه وعبوته بشاهدَين فأكثر. */
export function isReady(r: StockLinkRow): boolean {
  return r.status === "UNLINKED_PRODUCT" && !r.notStock && r.evidence !== null
    && r.evidence.matches >= READY_MIN_MATCHES && r.evidence.contentQuantity !== null;
}

/**
 * يُقرّ ما اختاره صاحبُه من الجاهز. الخادمُ يعيد اشتقاقَ الاقتراح الآن — لا يأخذ من
 * المتصفّح إلّا المعرّفات — وما لم يعد جاهزاً يُتخطّى ويُعدّ.
 */
export async function approveReadyLinks(ids: readonly string[], actorId: string): Promise<{ linked: number; skipped: number; valueMinor: number }> {
  const { rows } = await loadStockLinks();
  const wanted = new Set(ids);
  let linked = 0;
  let skipped = 0;
  let valueMinor = 0;
  for (const r of rows) {
    if (!wanted.has(r.supplierProductId)) continue;
    if (!isReady(r) || !r.evidence || r.evidence.contentQuantity === null) { skipped++; continue; }
    try {
      await savePurchaseLink({
        supplierProductId: r.supplierProductId, productId: r.evidence.productId,
        packSize: "1", contentQuantity: r.evidence.contentQuantity, contentUnit: r.evidence.baseUnit,
      }, actorId);
      linked++;
      valueMinor += r.valueMinor;
    } catch (e) {
      if (!(e instanceof PurchaseLinkRefused)) throw e;
      skipped++;
    }
  }
  return { linked, skipped: skipped + [...wanted].filter((id) => !rows.some((r) => r.supplierProductId === id)).length, valueMinor };
}

/** للاختبار وللتقرير: كم يصير ما يدخل الحساب لو أُقرّ الجاهزُ كلُّه. */
export function coverageAfterReady(links: StockLinks): { nowBp: number | null; afterBp: number | null } {
  const whole = links.totalMinor - links.notStockMinor;
  const bp = (part: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : null);
  return { nowBp: bp(links.measuredMinor), afterBp: bp(links.measuredMinor + links.readyMinor) };
}
