/**
 * آخرُ ما حرّك رقماً رئيسيّاً — من `audit_logs` وحده (انظر `lib/figure-history.ts`).
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { FIGURE_ACTIONS, describeMover, type FigureId, type Mover } from "@/lib/figure-history";
import { formatMoment } from "@/lib/riyadh-time";

export interface MoverRow extends Mover {
  id: string;
  /** «اليوم 14:20» — بتوقيت الرياض. */
  when: string;
}

export async function loadFigureMovers(figure: FigureId, viewerId: string, limit = 12): Promise<MoverRow[]> {
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      after: auditLogs.after,
      at: auditLogs.at,
      actorId: auditLogs.actorId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(inArray(auditLogs.action, [...FIGURE_ACTIONS[figure]]))
    .orderBy(desc(auditLogs.at))
    .limit(limit);
  return rows.map((r) => ({ id: String(r.id), when: formatMoment(r.at), ...describeMover(r, viewerId) }));
}
