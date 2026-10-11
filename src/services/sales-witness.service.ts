/**
 * شاهدُ المبيعات لأشهر الإقرار — مجاميعُ ملفّ فودكس المستورَد يوماً يوماً
 * (`lib/sales/witness.ts`). قراءةٌ وحدها: لا تكتب في الإقرار ولا في مبيعات النقد.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { buildSalesWitness, type SalesWitness, type WitnessDay } from "@/lib/sales/witness";
import { todayInRiyadh, isoDay } from "@/lib/riyadh-time";
import type { Conn } from "./types";

export interface WitnessMonthInput {
  month: string;
  returnOutputVatMinor: number;
  cashTypedGrossMinor: number | null;
}

export async function loadSalesDays(from: string, until: string, conn: Conn = db): Promise<WitnessDay[]> {
  const rows = (await conn.execute<{ day: string; sales: string; vat: string; refunds: string }>(sql`
    select business_date as day,
           coalesce(sum(net_minor), 0)::bigint    as sales,
           coalesce(sum(vat_minor), 0)::bigint    as vat,
           coalesce(sum(refund_minor), 0)::bigint as refunds
      from sales
     where is_void = false and business_date >= ${from} and business_date < ${until}
     group by business_date
     order by business_date
  `)).rows;
  return rows.map((r) => ({ day: r.day, salesMinor: Number(r.sales), vatMinor: Number(r.vat), refundMinor: Number(r.refunds) }));
}

function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return isoDay(new Date(Date.UTC(y, m, 1)));
}

export async function loadSalesWitness(months: readonly WitnessMonthInput[], conn: Conn = db): Promise<SalesWitness[]> {
  if (months.length === 0) return [];
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const days = await loadSalesDays(`${sorted[0].month}-01`, nextMonthStart(sorted[sorted.length - 1].month), conn);
  const today = todayInRiyadh();
  return sorted.map((m) => buildSalesWitness({ ...m, today, days }));
}
