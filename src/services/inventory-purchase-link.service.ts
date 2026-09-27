/**
 * ربطُ بنود الفواتير بأصناف الجرد — من داخل الجرد.
 *
 * طلبه أحمد (٢٧ سبتمبر ٢٠٢٦): أسماءُ أصناف الوصفات غيرُ أسمائها في فواتير
 * الشراء، فتبقى مشترياتُ الجرد «غير معروفة». والربطُ موجودٌ في «التحليل» بعيداً
 * عن الجرد، و**ما في الوحدة الواحدة** (مواصفةُ العبوة) لا تكتبه شاشةٌ أصلاً —
 * فحتى المربوطُ يبقى «مواصفةُ عبوة المورّد غير معروفة».
 *
 * فهنا: كلُّ صنفِ مورّدٍ اشتُري في أسبوع الجرد، بحاله (مربوط · بلا ربط · بلا
 * عبوة · وحدةٌ لا تُحوَّل)، وما يُحسَب منه لو رُبط. والحفظُ يكتب الربطَ والعبوةَ
 * معاً بعد التحقّق من عائلة الوحدة، والجردُ يُعاد حسابُه — والاستلامُ اليدويّ
 * يبقى يغلب البندَ متى أدخله صاحبُه.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, supplierProducts } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { decimalToMilli, formatQuantity, milliToDecimal, sameUnitFamily } from "@/lib/inventory/units";
import { purchaseQuantity, PURCHASE_GAP_LABEL, type PurchaseGapReason } from "@/lib/inventory/purchases";
import { guessPackSpec, suggestStockItem, type PackGuess } from "@/lib/inventory/purchase-link";
import { isStoredUnit, storedUnitLabel, type StoredUnit } from "@/lib/unit-conversion";
import type { Conn } from "./types";

export interface StockItemOption {
  id: string;
  nameAr: string;
  nameEn: string | null;
  baseUnit: StoredUnit;
  /** أسماءُ أصناف المورّدين المربوطة به — للاقتراح وحده. */
  aliases: string[];
}

export interface PurchaseLinkRow {
  supplierProductId: string;
  supplierName: string;
  /** اسمُه كما في الفاتورة. */
  displayName: string;
  productId: string | null;
  productName: string | null;
  pack: PackGuess | null;
  /** ما يُقترح إن لم يُكتب — من نصّ البند واسم الصنف. */
  suggestedProductId: string | null;
  guessedPack: PackGuess | null;
  lines: number;
  invoiceNumbers: string[];
  /** مجموعُ الكمّيّات كما في الفواتير — «5» وحداتٍ من وحدة المورّد. */
  qtyText: string;
  status: "LINKED" | PurchaseGapReason;
  statusLabel: string | null;
  /** ما دخل الجردَ منه — بوحدة الصنف — إن عُرف. */
  countedText: string | null;
}

/** «1.000» كما تُرجعه `numeric(12,3)` ← «1» للعرض والنموذج. */
const plain = (d: string) => (d.includes(".") ? d.replace(/\.?0+$/, "") : d);

export async function loadStockItemOptions(conn: Conn = db): Promise<StockItemOption[]> {
  const rows = await conn.select({ id: products.id, nameAr: products.nameAr, nameEn: products.nameEn, baseUnit: products.baseUnit })
    .from(products)
    .where(and(eq(products.isStockItem, true), eq(products.isActive, true)))
    .orderBy(products.nameAr);
  const linked = await conn.select({ productId: supplierProducts.productId, name: supplierProducts.displayName })
    .from(supplierProducts).where(sql`${supplierProducts.productId} is not null`);
  const aliases = new Map<string, string[]>();
  for (const l of linked) if (l.productId) aliases.set(l.productId, [...(aliases.get(l.productId) ?? []), l.name]);
  return rows.flatMap((r) => (isStoredUnit(r.baseUnit) ? [{ ...r, baseUnit: r.baseUnit, aliases: aliases.get(r.id) ?? [] }] : []));
}

/** كلُّ صنفِ مورّدٍ اشتُري في الفترة — بحاله وما يُحسَب منه. */
export async function loadPurchaseLinks(
  periodStart: string,
  periodEnd: string,
  options: readonly StockItemOption[],
  conn: Conn = db,
): Promise<PurchaseLinkRow[]> {
  const rows = (await conn.execute<{
    sp_id: string; supplier_name: string; display_name: string; product_id: string | null; product_name: string | null;
    pack_size: string | null; content_quantity: string | null; content_unit: string | null;
    qty: string | null; invoice_number: string; line_total_minor: number;
  }>(sql`
    select sp.id as sp_id, su.name_ar as supplier_name, sp.display_name, sp.product_id, p.name_ar as product_name,
           sp.pack_size::text, sp.content_quantity::text, sp.content_unit::text,
           il.qty::text, i.invoice_number, il.line_total_minor
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      join suppliers su on su.id = i.supplier_id
      join supplier_products sp on sp.id = il.supplier_product_id
      left join products p on p.id = sp.product_id
     where coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD'))
           between ${periodStart} and ${periodEnd}
       and not exists (select 1 from inventory_receipts r where r.invoice_line_id = il.id and r.voided_at is null)
     order by su.name_ar, sp.display_name
  `)).rows;

  const byId = new Map(options.map((o) => [o.id, o]));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.sp_id, [...(groups.get(r.sp_id) ?? []), r]);

  return [...groups.values()].map((g): PurchaseLinkRow => {
    const r = g[0];
    const contentUnit = r.content_unit && isStoredUnit(r.content_unit) ? r.content_unit : null;
    const pack: PackGuess | null = r.pack_size && r.content_quantity && contentUnit
      ? { packSize: plain(r.pack_size), contentQuantity: plain(r.content_quantity), contentUnit }
      : null;
    const product = r.product_id ? byId.get(r.product_id) : undefined;

    let counted = 0;
    let reason: PurchaseGapReason | null = product ? null : "UNLINKED_PRODUCT";
    if (product) {
      for (const line of g) {
        const q = purchaseQuantity({
          lineId: "", invoiceId: "", invoiceNumber: line.invoice_number, supplierName: r.supplier_name, invoiceDate: "",
          description: r.display_name, productId: product.id, qty: line.qty, lineTotalMinor: Number(line.line_total_minor),
          packSize: r.pack_size, contentUnit, contentQuantity: r.content_quantity,
        }, product.baseUnit);
        if (q.known) counted += q.canonicalMilli;
        else { reason = q.reason; break; }
      }
    }
    /* الكمّيّةُ بالمِلّي لا عدداً عائماً — ومجهولُها لا يُجمَع صفراً */
    const qtyMilli = g.map((l) => decimalToMilli(l.qty));
    const qtyText = qtyMilli.some((q) => q === null) ? "غير معروفة في بعضها" : plain(milliToDecimal(qtyMilli.reduce<number>((s, q) => s + (q ?? 0), 0)));
    return {
      supplierProductId: r.sp_id,
      supplierName: r.supplier_name,
      displayName: r.display_name,
      productId: product?.id ?? null,
      productName: product?.nameAr ?? r.product_name,
      pack,
      suggestedProductId: product ? null : suggestStockItem(r.display_name, options)?.id ?? null,
      guessedPack: pack ? null : guessPackSpec(r.display_name),
      lines: g.length,
      invoiceNumbers: [...new Set(g.map((l) => l.invoice_number))].slice(0, 4),
      qtyText,
      status: reason ?? "LINKED",
      statusLabel: reason ? PURCHASE_GAP_LABEL[reason] : null,
      countedText: reason === null && product ? formatQuantity(counted, product.baseUnit) : null,
    };
  }).sort((a, b) => Number(a.status === "LINKED") - Number(b.status === "LINKED"));
}

export class PurchaseLinkRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseLinkRefused";
  }
}

const DECIMAL = /^\d{1,7}(\.\d{1,3})?$/;

/** يكتب الربطَ وما في الوحدة معاً — بعد التحقّق أنّ الوحدة تُحوَّل إلى وحدة الصنف. */
export async function savePurchaseLink(
  input: { supplierProductId: string; productId: string; packSize: string; contentQuantity: string; contentUnit: StoredUnit },
  actorId: string,
  conn: Conn = db,
): Promise<{ productName: string }> {
  if (!DECIMAL.test(input.packSize) || (decimalToMilli(input.packSize) ?? 0) <= 0) throw new PurchaseLinkRefused("عددُ العبوات في الوحدة رقمٌ أكبر من صفر");
  if (!DECIMAL.test(input.contentQuantity) || (decimalToMilli(input.contentQuantity) ?? 0) <= 0) throw new PurchaseLinkRefused("كمّيّةُ العبوة رقمٌ أكبر من صفر");

  const [sp] = await conn.select({
    id: supplierProducts.id, productId: supplierProducts.productId, packSize: supplierProducts.packSize,
    contentQuantity: supplierProducts.contentQuantity, contentUnit: supplierProducts.contentUnit, name: supplierProducts.displayName,
  }).from(supplierProducts).where(eq(supplierProducts.id, input.supplierProductId)).limit(1);
  if (!sp) throw new PurchaseLinkRefused("صنفُ المورّد غير موجود — حدّث الصفحة");

  const [product] = await conn.select({ id: products.id, nameAr: products.nameAr, baseUnit: products.baseUnit, isStockItem: products.isStockItem })
    .from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product || !product.isStockItem) throw new PurchaseLinkRefused("اختر صنفاً من أصناف الجرد");
  if (!isStoredUnit(product.baseUnit) || !sameUnitFamily(input.contentUnit, product.baseUnit)) {
    throw new PurchaseLinkRefused(
      `«${product.nameAr}» يُقاس بـ${isStoredUnit(product.baseUnit) ? storedUnitLabel(product.baseUnit) : product.baseUnit}`
      + ` — و${storedUnitLabel(input.contentUnit)} لا تُحوَّل إليه. اختر وحدةً من عائلته.`,
    );
  }

  /* الربطُ وسجلُّه معاً أو لا شيء — `t` لا `conn` داخلها */
  await conn.transaction(async (t) => {
    await t.update(supplierProducts).set({
      productId: product.id,
      packSize: input.packSize,
      contentQuantity: input.contentQuantity,
      contentUnit: input.contentUnit,
      confirmedById: actorId,
      confirmedAt: new Date(),
    }).where(eq(supplierProducts.id, sp.id));

    await recordAudit({
      actorId,
      action: "PRODUCT_LINKED",
      entityType: "supplier_product",
      entityId: sp.id,
      before: { الصنف: sp.productId, العبوة: sp.packSize, المحتوى: sp.contentQuantity, الوحدة: sp.contentUnit },
      after: {
        "اسمه في الفاتورة": sp.name,
        "صنف الجرد": product.nameAr,
        "في الوحدة": `${input.packSize} × ${input.contentQuantity} ${storedUnitLabel(input.contentUnit)}`,
        المصدر: "الجرد",
      },
    }, t);
  });
  return { productName: product.nameAr };
}
