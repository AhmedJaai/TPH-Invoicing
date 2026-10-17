/**
 * مقارناتُ فودكس من القاعدة — تجلب الطرفين وتترك الحكمَ للدوالّ الخالصة
 * (`lib/foodics/purchase-compare.ts` · `lib/foodics/takings.ts`). قراءةٌ وحدها.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { foodicsSuppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import {
  comparePurchases, suggestSupplierLinks,
  type InvoiceSide, type PurchaseComparison, type PurchaseSide, type SupplierLinkSuggestion,
} from "@/lib/foodics/purchase-compare";
import { INVENTORY_TX, INVENTORY_TX_POSTED } from "@/lib/foodics/types";

export interface FoodicsSupplierRow {
  id: string;
  name: string;
  linkedSupplierId: string | null;
  linkedSupplierName: string | null;
  purchases: number;
  totalMinor: number;
}

export interface PurchaseWitness {
  comparison: PurchaseComparison;
  suggestions: SupplierLinkSuggestion[];
  foodicsSuppliers: FoodicsSupplierRow[];
  ourSuppliers: { id: string; name: string }[];
  /** مورّدٌ عندنا يشبه اسمُه اسمَ مورّد فودكس — تلميحٌ يُعرَض حين لا دليلَ من الفواتير، لا ربط. */
  nameHints: Record<string, { supplierId: string; supplierName: string }>;
  /** مرتجَعاتٌ إلى المورّد في فودكس — تُعدّ وتُعرَض، ولا تُطابَق بفاتورة. */
  returns: { reference: string; businessDate: string; supplierName: string | null; totalMinor: number }[];
  /** حركاتُ شراءٍ لم تُرحَّل بعد في فودكس — مسوّداتٌ لا يُقارَن بها. */
  drafts: number;
}

export async function loadPurchaseWitness(): Promise<PurchaseWitness> {
  const [purchases, invoices, suppliers, ours] = await Promise.all([
    db.execute<{
      id: string; reference: string; type: number; status: number; business_date: string; foodics_supplier_id: string | null;
      supplier_name: string | null; linked_supplier_id: string | null; invoice_number: string | null; invoice_date: string | null; total_minor: number;
    }>(sql`
      select fp.id, fp.reference, fp.type, fp.status, fp.business_date, fp.foodics_supplier_id,
             fs.name as supplier_name, fs.supplier_id as linked_supplier_id,
             fp.invoice_number, fp.invoice_date, fp.total_minor
        from foodics_purchases fp
        left join foodics_suppliers fs on fs.id = fp.foodics_supplier_id
    `),
    db.execute<{ id: string; supplier_id: string; supplier_name: string; invoice_number: string; day: string; total_minor: number }>(sql`
      select i.id, i.supplier_id, s.name_ar as supplier_name, i.invoice_number,
             to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, i.total_minor
        from invoices i join suppliers s on s.id = i.supplier_id
    `),
    db.execute<{ id: string; name: string; supplier_id: string | null; linked_name: string | null; purchases: number; total: string | null }>(sql`
      select fs.id, fs.name, fs.supplier_id, s.name_ar as linked_name,
             count(fp.id)::int as purchases, coalesce(sum(fp.total_minor), 0)::bigint as total
        from foodics_suppliers fs
        left join suppliers s on s.id = fs.supplier_id
        left join foodics_purchases fp on fp.foodics_supplier_id = fs.id and fp.type = ${INVENTORY_TX.PURCHASING}
       group by fs.id, fs.name, fs.supplier_id, s.name_ar
       order by count(fp.id) desc, fs.name
    `),
    db.execute<{ id: string; name: string; name_en: string | null }>(sql`select id, name_ar as name, name_en from suppliers order by name_ar`),
  ]);

  const posted = purchases.rows.filter((p) => Number(p.status) === INVENTORY_TX_POSTED);
  const side: PurchaseSide[] = posted
    .filter((p) => Number(p.type) === INVENTORY_TX.PURCHASING)
    .map((p) => ({
      id: p.id, reference: p.reference, businessDate: p.business_date,
      foodicsSupplierId: p.foodics_supplier_id, foodicsSupplierName: p.supplier_name,
      linkedSupplierId: p.linked_supplier_id, invoiceNumber: p.invoice_number, invoiceDate: p.invoice_date,
      totalMinor: Number(p.total_minor),
    }));
  const invoiceSide: InvoiceSide[] = invoices.rows.map((i) => ({
    id: i.id, supplierId: i.supplier_id, supplierName: i.supplier_name, invoiceNumber: i.invoice_number, day: i.day, totalMinor: Number(i.total_minor),
  }));

  const comparison = comparePurchases(side, invoiceSide);
  return {
    comparison,
    suggestions: suggestSupplierLinks(comparison.matched),
    foodicsSuppliers: suppliers.rows.map((s) => ({
      id: s.id, name: s.name, linkedSupplierId: s.supplier_id, linkedSupplierName: s.linked_name,
      purchases: Number(s.purchases), totalMinor: Number(s.total ?? 0),
    })),
    ourSuppliers: ours.rows.map((o) => ({ id: o.id, name: o.name })),
    nameHints: Object.fromEntries(suppliers.rows.flatMap((f) => {
      const like = ours.rows.filter((o) => namesAlike(f.name, o.name) || (o.name_en !== null && namesAlike(f.name, o.name_en)));
      /* تلميحٌ واحدٌ لا لبسَ فيه، أو لا تلميح */
      return like.length === 1 ? [[f.id, { supplierId: like[0].id, supplierName: like[0].name }] as const] : [];
    })),
    returns: posted
      .filter((p) => Number(p.type) === INVENTORY_TX.RETURN_TO_SUPPLIER)
      .map((p) => ({ reference: p.reference, businessDate: p.business_date, supplierName: p.supplier_name, totalMinor: Number(p.total_minor) })),
    drafts: purchases.rows.length - posted.length,
  };
}

/** كلماتٌ تصف الكيان لا تسمّيه — لا يُشبَّه بها. */
const GENERIC_WORDS = new Set(["شركه", "موسسه", "محمصه", "مصنع", "مورد", "للتجاره", "التجاريه", "company", "co", "est", "roastery", "factory", "trading", "coffee", "القهوه", "قهوه"]);

function nameWords(name: string): string[] {
  return name.toLowerCase()
    .replace(/[\u064b-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .split(/[^a-z0-9\u0600-\u06ff]+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

/** أيشتركان في كلمةٍ مميِّزة؟ — تلميحٌ للعين لا هويّة: «Aval» و«AVAL»، «محمصة رونه» و«رونة». */
export function namesAlike(a: string, b: string): boolean {
  const left = new Set(nameWords(a));
  return nameWords(b).some((w) => left.has(w));
}

/** بنودُ حركة شراءٍ في فودكس وبنودُ فاتورتنا — جنباً إلى جنب، لمن يريد أن يرى أين الفرق. */
export interface PairLines {
  foodics: { name: string; sku: string | null; unit: string | null; quantityMilli: number; costMinor: number }[];
  ours: { description: string; qty: string | null; unitPriceMinor: number | null; lineTotalMinor: number | null }[];
}

export async function loadPairLines(purchaseId: string, invoiceId: string | null): Promise<PairLines> {
  const [f, o] = await Promise.all([
    db.execute<{ name: string; sku: string | null; storage_unit: string | null; quantity_milli: string; cost_minor: number }>(sql`
      select name, sku, storage_unit, quantity_milli, cost_minor from foodics_purchase_items where purchase_id = ${purchaseId} order by position
    `),
    invoiceId === null
      ? Promise.resolve({ rows: [] as { description: string; qty: string | null; unit_price_minor: number | null; line_total_minor: number | null }[] })
      : db.execute<{ description: string; qty: string | null; unit_price_minor: number | null; line_total_minor: number | null }>(sql`
          select description, qty::text as qty, unit_price_minor, line_total_minor from invoice_lines where invoice_id = ${invoiceId} order by id
        `),
  ]);
  return {
    foodics: f.rows.map((r) => ({ name: r.name, sku: r.sku, unit: r.storage_unit, quantityMilli: Number(r.quantity_milli), costMinor: Number(r.cost_minor) })),
    ours: o.rows.map((r) => ({ description: r.description, qty: r.qty, unitPriceMinor: r.unit_price_minor === null ? null : Number(r.unit_price_minor), lineTotalMinor: r.line_total_minor === null ? null : Number(r.line_total_minor) })),
  };
}

export class UnknownFoodicsSupplierError extends Error {
  constructor() {
    super("لم يُعثر على مورّد فودكس هذا. زامن فودكس ثمّ حاول مرة أخرى.");
    this.name = "UnknownFoodicsSupplierError";
  }
}

/** يربط مورّدَ فودكس بمورّدنا أو يفكّه (`supplierId` فارغ). قرارُ إنسانٍ يُكتب في السجلّ بطرفيه. */
export async function linkFoodicsSupplier(foodicsSupplierId: string, supplierId: string | null, actorId: string): Promise<{ name: string; supplierName: string | null }> {
  return db.transaction(async (t) => {
    const before = (await t.execute<{ name: string; supplier_id: string | null }>(sql`
      select name, supplier_id from foodics_suppliers where id = ${foodicsSupplierId} for update
    `)).rows[0];
    if (!before) throw new UnknownFoodicsSupplierError();
    const target = supplierId === null ? null : (await t.execute<{ name_ar: string }>(sql`select name_ar from suppliers where id = ${supplierId}`)).rows[0];
    if (supplierId !== null && !target) throw new UnknownFoodicsSupplierError();

    await t.update(foodicsSuppliers)
      .set({ supplierId, linkedById: supplierId === null ? null : actorId, linkedAt: supplierId === null ? null : new Date() })
      .where(sql`${foodicsSuppliers}.id = ${foodicsSupplierId}`);
    await recordAudit({
      actorId, action: "SUPPLIER_FOODICS_LINKED", entityType: "foodics_supplier", entityId: foodicsSupplierId,
      before: { مورّد_فودكس: before.name, المورّد: before.supplier_id },
      after: { مورّد_فودكس: before.name, المورّد: supplierId, اسمه: target?.name_ar ?? null },
    }, t);
    return { name: before.name, supplierName: target?.name_ar ?? null };
  });
}
