/**
 * أشهرٌ فُتحت للتصحيح — ما خُتم منها ثمّ أُعيد فتحه ولم يُقفل بعد.
 *
 * كان التصحيحُ في الماضي شهراً شهراً: يُفتح، ويُصحَّح، ويُقفل — ستّةٌ وستّون فتحاً لأشهر مايو إلى
 * أكتوبر، ولا يُرى في أثنائها كم تغيّر ربحُ كلّ شهرٍ عمّا خُتم. فتُعرض هنا بربحها المجمَّد وربحها
 * الآن والفرقِ بالهللة، ومن فتحها ولماذا — ويُعاد إقفالُها معاً من «إقفال الشهر».
 *
 * قراءةٌ لا كتابة: الفتحُ والإقفالُ من بابهما (`/api/month-close`) شهراً شهراً.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { loadLivePnl } from "./profit.service";
import type { Conn } from "./types";

export interface MonthInCorrection {
  month: string;
  /** الربحُ كما جُمِّد عند آخر إقفال. */
  frozenProfitMinor: number | null;
  /** الربحُ كما يُحسب الآن. */
  liveProfitMinor: number | null;
  /** الآن ناقصاً المجمَّد — `null` إن جُهل أحدُهما. */
  deltaMinor: number | null;
  reopenedAt: string | null;
  reason: string | null;
}

export async function loadMonthsInCorrection(conn: Conn = db): Promise<MonthInCorrection[]> {
  const rows = (await conn.execute<{ month: string; frozen: string | null; reopened_at: string | null; reason: string | null }>(sql`
    select mc.month,
           (fs.payload -> 'pnl' ->> 'profitMinor') as frozen,
           (select max(a.at)::text from audit_logs a where a.action = 'MONTH_REOPENED' and a.entity_id = mc.month) as reopened_at,
           (select a.after ->> 'السبب' from audit_logs a where a.action = 'MONTH_REOPENED' and a.entity_id = mc.month order by a.at desc limit 1) as reason
      from month_closes mc
      join finance_snapshots fs on fs.month = mc.month
     where mc.status <> 'CLOSED'
     order by mc.month
  `)).rows;
  const out: MonthInCorrection[] = [];
  /* متتابعةٌ: كلُّ شهرٍ يحمّل مبيعاته، والأشهرُ المفتوحة للتصحيح قليلة */
  for (const r of rows) {
    const live = await loadLivePnl(r.month, conn).catch(() => null);
    const frozen = r.frozen === null || r.frozen === "" ? null : Number(r.frozen);
    const now = live?.pnl.profitMinor ?? null;
    out.push({
      month: r.month, frozenProfitMinor: frozen, liveProfitMinor: now,
      deltaMinor: frozen === null || now === null ? null : now - frozen,
      reopenedAt: r.reopened_at, reason: r.reason,
    });
  }
  return out;
}
