/**
 * «توريدٌ قُيِّد مرّتين؟» — الفواتيرُ ببنودها إلى `lib/repeat-delivery.ts`، ومعها شاهدان:
 * كم مرّةً استلم فودكس من هذا المورّد في تلك الأيّام، وكم سُدِّد من كلٍّ منهما.
 *
 * وفودكس يحسم حين يعرف: مورّدٌ مربوطٌ استلم منه مرّتين في النافذة فهما توريدان — لا سؤال.
 * ومرّةً واحدة تُقال مع السؤال؛ وغيرُ المربوط `null` (لا يُعرف، لا «صفر»).
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { findRepeatDeliveries, REPEAT_WINDOW_DAYS, type DeliveryInvoice } from "@/lib/repeat-delivery";
import { silencedKeys } from "@/lib/signal-decisions";
import { addDays, todayInRiyadh } from "@/lib/riyadh-time";

/** ما قبله تاريخٌ لا عمل — والاستردادُ بعد نصف سنةٍ حديثٌ آخر. */
export const REPEAT_LOOKBACK_DAYS = 200;
/** فودكس يُدخل الاستلامَ يومَه أو بعده بقليل. */
const FOODICS_SLACK_DAYS = 2;

export const repeatDeliveryKey = (firstId: string, secondId: string) => `repeat-delivery:${firstId}:${secondId}`;

export interface RepeatDelivery {
  key: string;
  supplierName: string;
  supplierSlug: string;
  first: { id: string; number: string; day: string; totalMinor: number; paidMinor: number };
  second: { id: string; number: string; day: string; totalMinor: number; paidMinor: number };
  gapDays: number;
  atStakeMinor: number;
  /** سُدِّدتا كلتاهما كاملتَين — فالمبلغُ خرج فعلاً. */
  bothPaid: boolean;
  /** مرّاتُ استلام فودكس من المورّد حولهما — `null` المورّدُ غير مربوطٍ بفودكس. */
  foodicsReceipts: number | null;
  silenced: boolean;
}

type LoadedInvoice = DeliveryInvoice & { name: string; slug: string; paidMinor: number };
type Building = Omit<LoadedInvoice, "lines"> & { lines: DeliveryInvoice["lines"][number][] };

/**
 * فواتيرُ النافذة وبنودُها — باستعلامين لا بربطٍ واحد.
 *
 * كان الربطُ يكرّر رأسَ الفاتورة (معرّفَها ومورّدَها واسمَه ورقمَها ومجموعَها) مع
 * كلّ بند، ويحسب «المدفوع» بسؤالٍ فرعيّ لكلّ بند — ٧٣٨ صفّاً و٢١١ ك.ب في كلّ رسمٍ
 * للقشرة. والرأسُ مرّةً لكلّ فاتورة، والبندُ معرّفُها ومفتاحُه وكمّيّتُه وحدها.
 */
export async function loadDeliveryInvoices(since: string): Promise<LoadedInvoice[]> {
  const [heads, lines] = await Promise.all([
    db.execute<{ id: string; supplier_id: string; name: string; slug: string; number: string; day: string; total: number; paid: string }>(sql`
      select i.id, i.supplier_id, s.name_ar as name, s.slug, i.invoice_number as number,
             to_char(i.invoice_date at time zone 'UTC', 'YYYY-MM-DD') as day, i.total_minor as total,
             coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as paid
        from invoices i
        join suppliers s on s.id = i.supplier_id
       where i.invoice_date >= ${since}::date
       order by i.id
    `),
    db.execute<{ id: string; line_key: string | null; qty_milli: string | null }>(sql`
      select l.invoice_id as id,
             coalesce(sp.product_id, l.normalized_description) as line_key,
             round(l.qty * 1000)::bigint as qty_milli
        from invoice_lines l
        join invoices i on i.id = l.invoice_id
        left join supplier_products sp on sp.supplier_id = i.supplier_id and sp.normalized_description = l.normalized_description
       where i.invoice_date >= ${since}::date
         and coalesce(sp.product_id, l.normalized_description) is not null
       order by l.invoice_id
    `),
  ]);
  const byId = new Map<string, Building>();
  for (const r of heads.rows) {
    byId.set(r.id, {
      id: r.id, supplierId: r.supplier_id, number: r.number, day: r.day, totalMinor: Number(r.total), lines: [],
      name: r.name, slug: r.slug, paidMinor: Number(r.paid),
    });
  }
  for (const r of lines.rows) {
    const inv = byId.get(r.id);
    if (inv && r.line_key !== null) inv.lines.push({ key: r.line_key, qtyMilli: r.qty_milli === null ? null : Number(r.qty_milli) });
  }
  return [...byId.values()];
}

export async function loadRepeatDeliveries(options: { includeSilenced?: boolean } = {}): Promise<RepeatDelivery[]> {
  const today = todayInRiyadh();
  const since = addDays(today, -REPEAT_LOOKBACK_DAYS);
  const [invoices, decisions] = await Promise.all([
    loadDeliveryInvoices(since),
    db.execute<{ key: string; decision: string }>(sql`select key, decision from alert_resolutions where key like 'repeat-delivery:%'`),
  ]);

  const byId = new Map(invoices.map((i) => [i.id, i]));
  const pairs = findRepeatDeliveries(invoices);
  if (pairs.length === 0) return [];
  const silenced = silencedKeys(decisions.rows, today);

  const out: RepeatDelivery[] = [];
  for (const p of pairs) {
    const key = repeatDeliveryKey(p.first.id, p.second.id);
    const isSilenced = silenced.has(key);
    if (isSilenced && !options.includeSilenced) continue;
    const [witness] = (await db.execute<{ linked: number; receipts: number }>(sql`
      select (select count(*) from foodics_suppliers fs where fs.supplier_id = ${p.supplierId} and fs.deleted_at is null)::int as linked,
             (select count(*) from foodics_purchases fp join foodics_suppliers fs on fs.id = fp.foodics_supplier_id
               where fs.supplier_id = ${p.supplierId}
                 and fp.business_date between ${addDays(p.first.day, -FOODICS_SLACK_DAYS)} and ${addDays(p.second.day, REPEAT_WINDOW_DAYS)})::int as receipts
    `)).rows;
    const foodicsReceipts = Number(witness.linked) > 0 ? Number(witness.receipts) : null;
    /* استلم مرّتين فهما توريدان */
    if (foodicsReceipts !== null && foodicsReceipts >= 2) continue;
    const first = byId.get(p.first.id)!;
    const second = byId.get(p.second.id)!;
    out.push({
      key, supplierName: first.name, supplierSlug: first.slug,
      first: { id: first.id, number: first.number, day: first.day, totalMinor: first.totalMinor, paidMinor: first.paidMinor },
      second: { id: second.id, number: second.number, day: second.day, totalMinor: second.totalMinor, paidMinor: second.paidMinor },
      gapDays: p.gapDays, atStakeMinor: p.atStakeMinor,
      bothPaid: first.paidMinor >= first.totalMinor && second.paidMinor >= second.totalMinor,
      foodicsReceipts, silenced: isSilenced,
    });
  }
  return out.sort((a, b) => b.atStakeMinor - a.atStakeMinor);
}
