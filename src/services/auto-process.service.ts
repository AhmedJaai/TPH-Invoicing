/**
 * «أوقف العمل الآليّ» — ضابطٌ بيد صاحب المقهى على ما يجري في الخلفيّة.
 *
 * الاستدراكُ والمزامنةُ الخلفيّة يقيّدان ويعتمدان بلا ضغطة. ومن أراد أن يراجع
 * بعينه أوّلاً — أو رأى رقماً تغيّر ولم يُرِده — لم يكن له إلّا أن يغلق التطبيق.
 * فصار له ضابط: صفٌّ في `job_state` (لا جدولَ جديد)، وجودُه «موقوف». والموقوفُ
 * الخلفيُّ وحده: الأزرارُ التي تُضغط بيد («زامن الآن»، «أكّد المؤهَّل») تعمل دائماً.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobState } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import type { Conn } from "./types";

const PAUSE_ROW = "auto-process:paused";

export interface AutoPause {
  paused: boolean;
  /** متى أُوقف — `null` إن كان يعمل. */
  since: Date | null;
}

export async function loadAutoPause(conn: Conn = db): Promise<AutoPause> {
  const [row] = await conn.select({ ranAt: jobState.ranAt }).from(jobState).where(eq(jobState.name, PAUSE_ROW)).limit(1);
  return row ? { paused: true, since: row.ranAt } : { paused: false, since: null };
}

export async function isAutoPaused(conn: Conn = db): Promise<boolean> {
  return (await loadAutoPause(conn)).paused;
}

/** يوقف أو يشغّل — ويُكتب أثرُه باسم من فعل. يُعيد `false` إن كان على الحال المطلوبة. */
export async function setAutoPaused(paused: boolean, actorId: string): Promise<boolean> {
  return db.transaction(async (t) => {
    const changed = paused
      ? (await t.insert(jobState).values({ name: PAUSE_ROW, fingerprint: actorId, ranAt: new Date() })
          .onConflictDoNothing().returning({ name: jobState.name })).length > 0
      : (await t.delete(jobState).where(eq(jobState.name, PAUSE_ROW)).returning({ name: jobState.name })).length > 0;
    if (changed) {
      await recordAudit({
        actorId,
        action: paused ? "DOCUMENT_AUTO_PAUSED" : "DOCUMENT_AUTO_RESUMED",
        entityType: "job",
        entityId: "auto-process",
        after: { الحال: paused ? "موقوف — لا قيدَ ولا اعتمادَ ولا مزامنةَ في الخلفيّة" : "يعمل" },
      }, t);
    }
    return changed;
  });
}
