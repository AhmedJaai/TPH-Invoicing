import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isStoredUnit, type StoredUnit } from "@/lib/unit-conversion";

/**
 * حركةُ صنفٍ واحد — ما دخل الرفَّ وما خرج منه بغير البيع، بترتيبه.
 *
 * قراءةٌ لا حساب: بندُ الفاتورة يُعرَض بكمّيّته ووصفه كما كُتبا («٣ ×
 * كيس بنّ ١ كجم»)، ولا تُحوَّل هنا عبوةٌ إلى جرامات — ذاك عملُ المحرّك،
 * وتحويلٌ ثانٍ في شاشة يفترق عنه يوماً. والجردُ نفسُه يأتي من
 * `itemHistory` بأسطره المحفوظة.
 */
export type MovementKind = "INVOICE" | "RECEIPT" | "WASTE" | "ADJUSTMENT";

export interface ItemMovement {
  id: string;
  kind: MovementKind;
  /** يومُ الواقعة — YYYY-MM-DD. */
  day: string;
  title: string;
  detail: string | null;
  /** كمّيّةٌ مقيسة بالمِلّي ووحدتها — لما أدخله إنسان. `null` لبند الفاتورة. */
  milli: number | null;
  unit: StoredUnit | null;
  /** نصُّ الكمّيّة كما في الفاتورة («3.000») — يُعرَض ولا يُحوَّل. */
  invoiceQty: string | null;
  amountMinor: number | null;
  href: string | null;
  voided: boolean;
}

const WASTE_REASON: Record<string, string> = {
  EXPIRED: "انتهت صلاحيّته",
  SPILLED: "انسكب",
  FAILED_PREP: "تحضيرٌ فاشل",
  CALIBRATION: "معايرةُ الماكينة",
  STAFF_DRINK: "مشروبُ موظَّف",
  DAMAGED: "تلف",
  OTHER: "سببٌ آخر",
};

const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: "رصيدٌ افتتاحيّ مسجَّل",
  ADJUST_IN: "إضافةٌ إلى الرفّ",
  ADJUST_OUT: "سحبٌ من الرفّ",
  TRANSFER_IN: "نقلٌ وارد",
  TRANSFER_OUT: "نقلٌ صادر",
};

function unitOf(v: unknown): StoredUnit | null {
  return isStoredUnit(v) ? v : null;
}

export async function itemMovements(productId: string, limit = 40): Promise<ItemMovement[]> {
  const [invoices, receipts, waste, moves] = await Promise.all([
    db.execute<Record<string, unknown>>(sql`
      select il.id, il.description, il.qty::text as qty, il.line_total_minor,
             i.id as invoice_id, i.invoice_number,
             coalesce(i.received_on, to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD')) as day,
             su.name_ar as supplier_name
        from invoice_lines il
        join invoices i on i.id = il.invoice_id
        join suppliers su on su.id = i.supplier_id
        join supplier_products sp on sp.id = il.supplier_product_id
       where sp.product_id = ${productId}
       order by day desc
       limit ${limit}
    `),
    db.execute<Record<string, unknown>>(sql`
      select r.id, r.received_on as day, r.canonical_milli, r.entered_milli, r.entered_unit,
             r.cost_minor, r.document_ref, r.voided_at, r.void_reason, su.name_ar as supplier_name
        from inventory_receipts r
        left join suppliers su on su.id = r.supplier_id
       where r.product_id = ${productId}
       order by r.received_on desc
       limit ${limit}
    `),
    db.execute<Record<string, unknown>>(sql`
      select w.id, w.occurred_on as day, w.quantity_milli, w.unit, w.reason, w.note
        from waste_records w
       where w.product_id = ${productId}
       order by w.occurred_on desc
       limit ${limit}
    `),
    db.execute<Record<string, unknown>>(sql`
      select m.id, m.occurred_on as day, m.kind, m.quantity_milli, m.unit, m.note
        from inventory_movements m
       where m.product_id = ${productId}
       order by m.occurred_on desc
       limit ${limit}
    `),
  ]);

  const out: ItemMovement[] = [
    ...invoices.rows.map((r): ItemMovement => ({
      id: `inv:${r.id}`,
      kind: "INVOICE",
      day: String(r.day),
      title: `فاتورة ${String(r.invoice_number)} — ${String(r.supplier_name)}`,
      detail: String(r.description),
      milli: null,
      unit: null,
      invoiceQty: r.qty === null ? null : String(r.qty),
      amountMinor: r.line_total_minor === null ? null : Number(r.line_total_minor),
      href: `/purchases/invoices/${String(r.invoice_id)}`,
      voided: false,
    })),
    ...receipts.rows.map((r): ItemMovement => ({
      id: `rcp:${r.id}`,
      kind: "RECEIPT",
      day: String(r.day),
      title: r.supplier_name ? `استلامٌ يدويّ — ${String(r.supplier_name)}` : "استلامٌ يدويّ",
      detail: r.voided_at
        ? `أُلغي${r.void_reason ? `: ${String(r.void_reason)}` : ""}`
        : r.document_ref ? `مستند ${String(r.document_ref)}` : null,
      milli: Number(r.entered_milli),
      unit: unitOf(r.entered_unit),
      invoiceQty: null,
      amountMinor: r.cost_minor === null ? null : Number(r.cost_minor),
      href: null,
      voided: r.voided_at !== null,
    })),
    ...waste.rows.map((r): ItemMovement => ({
      id: `wst:${r.id}`,
      kind: "WASTE",
      day: String(r.day),
      title: `هدرٌ مسجَّل — ${WASTE_REASON[String(r.reason)] ?? String(r.reason)}`,
      detail: r.note ? String(r.note) : null,
      milli: Number(r.quantity_milli),
      unit: unitOf(r.unit),
      invoiceQty: null,
      amountMinor: null,
      href: null,
      voided: false,
    })),
    ...moves.rows.map((r): ItemMovement => ({
      id: `mov:${r.id}`,
      kind: "ADJUSTMENT",
      day: String(r.day),
      title: MOVEMENT_LABEL[String(r.kind)] ?? String(r.kind),
      detail: r.note ? String(r.note) : null,
      milli: Number(r.quantity_milli),
      unit: unitOf(r.unit),
      invoiceQty: null,
      amountMinor: null,
      href: null,
      voided: false,
    })),
  ];

  return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, limit);
}

/**
 * أين يُصرَف هذا الصنف — الأصنافُ المباعة التي تصل إليه وصفتُها السارية.
 *
 * و«السارية» المفتوحةُ الطرف لا `ACTIVE` وحدها: تفعيلُ نسخةٍ يترك
 * سابقتَها `ACTIVE` بطرفٍ مغلق (القرار في `inventory-foodics.md`).
 */
export async function itemUsage(productId: string): Promise<{ menuProductId: string; name: string }[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select distinct p.id, p.name_ar
      from recipe_ingredients ri
      join recipe_versions rv on rv.id = ri.recipe_version_id
      join recipes r on r.id = rv.recipe_id
      join products p on p.id = r.product_id
     where ri.product_id = ${productId}
       and rv.status = 'ACTIVE'
       and rv.effective_to is null
     order by p.name_ar
  `);
  return rows.rows.map((r) => ({ menuProductId: String(r.id), name: String(r.name_ar) }));
}
