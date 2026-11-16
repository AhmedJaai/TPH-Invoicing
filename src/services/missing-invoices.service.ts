/**
 * فواتيرُ يُحتمل غيابُها — يجلب الشهودَ من مصادرهم القائمة ويترك الحكمَ للدالّة الخالصة
 * (`lib/missing-invoices.ts`). قراءةٌ وحدها: لا يُنشئ فاتورةً ولا يمسّ مالاً.
 *
 * كلُّ شاهدٍ من **تعريفه الواحد** في خدمته: سطورُ الكشف من `latestStatementMissing`، وحركاتُ
 * فودكس من `loadPurchaseWitness` بعد ما أسكته صاحبُه، والدفعاتُ من `loadUnbackedPayments` —
 * فلا يقول هذا الموضعُ رقماً يخالف صفحةَ الشاهد نفسِه.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ACTIVE_WINDOW_DAYS, buildMissingBoard,
  type FoodicsWitness, type MissingBoard, type PaymentWitness, type StatementWitness, type SupplierFacts,
} from "@/lib/missing-invoices";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";
import type { StoredUnit } from "@/lib/unit-conversion";
import { purchaseSignalKey } from "./foodics-attention.service";
import { loadPurchaseWitness } from "./foodics-compare.service";
import { loadFoodicsSilenced } from "./foodics-takings.service";
import { latestStatementMissing } from "./statement-reconcile.service";
import { loadStockBalance } from "./stock-balance.service";
import { loadUnbackedPayments } from "./supplier-followups.service";

export interface MissingInvoicesView {
  board: MissingBoard;
  /** حركاتُ شراءٍ في فودكس بلا فاتورة ومورّدُها هناك غيرُ مربوط — لا تُنسب، فتُعدّ وتُحال إلى صفحتها. */
  unattributedFoodics: { count: number; totalMinor: number };
  /**
   * فواتيرُنا المؤرَّخة في كلّ فجوةٍ بين كشفين — بمفتاح `{المورّد}:{أوّل الفجوة}`. هي ما لم يفحصه
   * كشف؛ وصفرٌ يعني أنّ الفجوة قد تكون أيّاماً بلا توريد.
   */
  invoicesInGap: Record<string, number>;
  today: string;
}

async function loadSupplierFacts(today: string): Promise<SupplierFacts[]> {
  const since = addDays(today, -ACTIVE_WINDOW_DAYS);
  const rows = (await db.execute<{
    id: string; name_ar: string; slug: string; issues_invoices: boolean; issues_statements: boolean;
    foodics_linked: boolean; last_invoice: string | null; recent: number; recent_minor: string;
  }>(sql`
    select s.id, s.name_ar, s.slug, s.issues_invoices, s.issues_statements,
           exists (select 1 from foodics_suppliers fs where fs.supplier_id = s.id and fs.deleted_at is null) as foodics_linked,
           (select to_char(max(i.invoice_date at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') from invoices i where i.supplier_id = s.id) as last_invoice,
           (select count(*)::int from invoices i
             where i.supplier_id = s.id and to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') >= ${since}) as recent,
           (select coalesce(sum(i.total_minor), 0)::bigint from invoices i
             where i.supplier_id = s.id and to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') >= ${since}) as recent_minor
      from suppliers s
     where s.is_active and s.merged_into_id is null
     order by s.name_ar
  `)).rows;
  const periods = (await db.execute<{ supplier_id: string; ps: string; pe: string }>(sql`
    select st.supplier_id, to_char(st.period_start, 'YYYY-MM-DD') as ps, to_char(st.period_end, 'YYYY-MM-DD') as pe
      from statements st
     where st.supplier_id is not null and st.period_start is not null and st.period_end is not null
  `)).rows;
  const bySupplier = new Map<string, { from: string; to: string }[]>();
  for (const p of periods) bySupplier.set(p.supplier_id, [...(bySupplier.get(p.supplier_id) ?? []), { from: p.ps, to: p.pe }]);
  return rows.map((r) => ({
    id: r.id, name: r.name_ar, slug: r.slug,
    issuesInvoices: Boolean(r.issues_invoices), issuesStatements: Boolean(r.issues_statements),
    foodicsLinked: Boolean(r.foodics_linked), lastInvoiceDay: r.last_invoice,
    recentInvoices: Number(r.recent), recentBilledMinor: Number(r.recent_minor),
    statements: bySupplier.get(r.id) ?? [],
  }));
}

export async function loadMissingInvoices(): Promise<MissingInvoicesView> {
  const today = todayInRiyadh();
  const [suppliers, statementLines, witness, silenced, unbacked] = await Promise.all([
    loadSupplierFacts(today),
    latestStatementMissing(),
    loadPurchaseWitness(),
    loadFoodicsSilenced("foodics-purchase"),
    loadUnbackedPayments(),
  ]);

  const statement: StatementWitness[] = statementLines.map((l) => ({
    supplierId: l.supplierId, ref: l.ref, day: l.day, amountMinor: l.amountMinor, unclear: l.unclear,
  }));
  const open = witness.comparison.onlyFoodics.filter((p) => !silenced.has(purchaseSignalKey(p.id)));
  const foodics: FoodicsWitness[] = open.flatMap((p) => (p.linkedSupplierId === null ? [] : [{
    supplierId: p.linkedSupplierId, purchaseId: p.id, invoiceNumber: p.invoiceNumber,
    /* يومُ المستند إن كُتب، وإلّا يومُ إدخالها — به تُقابَل بسطر الكشف */
    day: p.invoiceDate ?? p.businessDate, amountMinor: p.totalMinor,
  }]));
  const unattributed = open.filter((p) => p.linkedSupplierId === null);
  /* من لا يصدر فواتير حوالتُه هي الشراء — لا فاتورةَ تُنتظر، وصياغتُه في «يحتاج قرارك» عقدُ توريد */
  const payments: PaymentWitness[] = unbacked.flatMap((p) => (p.supplierId === null || !p.issuesInvoices ? [] : [{
    supplierId: p.supplierId, paymentId: p.paymentId, day: p.paidOn, unbackedMinor: p.unbackedMinor,
  }]));

  const board = buildMissingBoard({ suppliers, statement, foodics, payments, today });
  const invoicesInGap: Record<string, number> = {};
  for (const g of board.coverGaps) {
    const [row] = (await db.execute<{ n: number }>(sql`
      select count(*)::int as n from invoices i
       where i.supplier_id = ${g.supplier.id}
         and to_char(i.invoice_date at time zone 'Asia/Riyadh', 'YYYY-MM-DD') between ${g.from} and ${g.to}
    `)).rows;
    invoicesInGap[`${g.supplier.id}:${g.from}`] = Number(row?.n ?? 0);
  }

  return {
    board, invoicesInGap,
    unattributedFoodics: { count: unattributed.length, totalMinor: unattributed.reduce((s, p) => s + p.totalMinor, 0) },
    today,
  };
}

/**
 * قرينةُ المخزون — صنفٌ صُرف منه بحسب الوصفات أكثرُ ممّا سُجّل شراؤه منذ البداية.
 *
 * **أضعفُ الشهود ويُقال إنّه أضعفُها**: يفسّره شراءٌ لم يدخل الدفاتر (فاتورةٌ غائبة أو بندٌ لم
 * يُربط بصنفه) كما تفسّره وصفةٌ تصرف أكثر من الواقع. فلا يدخل مجموعَ اللوحة، ويُعرَض معه ما
 * لمورّديه من بنودٍ غير مربوطة — التفسيرُ الأقرب يُجرَّب أوّلاً.
 */
export interface StockLead {
  productId: string;
  name: string;
  baseUnit: StoredUnit;
  /** ما صُرف فوق المشترى — موجب، بمِلّي وحدة الأساس. */
  shortMilli: number;
  /** وقيمتُه بآخر كلفةٍ معروفة — `null` لا كلفة. */
  shortMinor: number | null;
  /** مورّدو هذا الصنف كما في فواتيرنا المربوطة. */
  suppliers: { id: string; name: string; slug: string }[];
  /** بنودُ فواتير هؤلاء المورّدين التي لم تُربط بصنف — قيمتُها. */
  suppliersUnlinkedMinor: number;
}

export async function loadStockLeads(): Promise<StockLead[]> {
  const [balance, sellers, unlinked] = await Promise.all([
    loadStockBalance(null),
    db.execute<{ product_id: string; id: string; name_ar: string; slug: string }>(sql`
      select distinct sp.product_id, s.id, s.name_ar, s.slug
        from supplier_products sp join suppliers s on s.id = sp.supplier_id
       where sp.product_id is not null and s.merged_into_id is null
    `),
    db.execute<{ supplier_id: string; minor: string }>(sql`
      select i.supplier_id, coalesce(sum(il.line_total_minor), 0)::bigint as minor
        from invoice_lines il
        join invoices i on i.id = il.invoice_id
        left join supplier_products sp on sp.id = il.supplier_product_id
       where sp.product_id is null
       group by i.supplier_id
    `),
  ]);
  const sellersOf = new Map<string, StockLead["suppliers"]>();
  for (const r of sellers.rows) sellersOf.set(r.product_id, [...(sellersOf.get(r.product_id) ?? []), { id: r.id, name: r.name_ar, slug: r.slug }]);
  const unlinkedOf = new Map(unlinked.rows.map((r) => [r.supplier_id, Number(r.minor)] as const));

  return balance.items
    .filter((x) => x.notes.includes("SOLD_MORE_THAN_BOUGHT") && !x.notes.includes("SUSPECT_ENTRY") && x.expectedMilli !== null && x.expectedMilli < 0)
    .map((x) => {
      const suppliers = sellersOf.get(x.productId) ?? [];
      return {
        productId: x.productId, name: x.name, baseUnit: x.baseUnit,
        shortMilli: -(x.expectedMilli ?? 0),
        shortMinor: x.expectedMinor === null ? null : -x.expectedMinor,
        suppliers,
        suppliersUnlinkedMinor: suppliers.reduce((s, sup) => s + (unlinkedOf.get(sup.id) ?? 0), 0),
      };
    })
    .sort((a, b) => (b.shortMinor ?? -1) - (a.shortMinor ?? -1) || a.name.localeCompare(b.name, "ar"));
}
