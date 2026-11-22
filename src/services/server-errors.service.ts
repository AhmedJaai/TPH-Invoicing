/**
 * أعطابُ الخادم تُحفظ في القاعدة (107) — سجلُّ Vercel يُحفظ ساعةً، وهذا يبقى.
 *
 * **لا يرمي أبداً**: يُستدعى من موضع عطبٍ قائم، وعطبٌ ثانٍ يخفي الأوّل. فإن تعذّرت الكتابة
 * (القاعدةُ هي العطبُ نفسُه غالباً) قيل ذلك سطراً في السجلّ ومضى.
 *
 * والصفُّ بمفتاحٍ من المسار والنوع والرسالة بعد طيّ الأرقام: العطبُ نفسُه يتكرّر فيزيد عدُّه
 * ولا يكبر الجدول. والرسالةُ مقصوصةٌ قبله (`describeError`) — لا قيمَ إدخالٍ ولا `params:`.
 */
import { createHash } from "node:crypto";
import { desc, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { serverErrors } from "@/db/schema";
import { logEvent, type ErrorFacts } from "@/lib/log";

export interface ServerErrorInput extends ErrorFacts {
  source: "REQUEST" | "ROUTE";
  route?: string | null;
  method?: string | null;
  ref?: string | null;
  digest?: string | null;
}

/** المعرّفاتُ والأرقامُ تُطوى: العطبُ نفسُه بطلبٍ آخر يُعدّ مرّةً ثانية لا صفّاً ثانياً. */
export function errorFingerprint(e: Pick<ServerErrorInput, "source" | "route" | "name" | "code" | "message">): string {
  const shape = e.message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d+/g, "<n>");
  return createHash("sha256").update([e.source, e.route ?? "", e.name ?? "", e.code ?? "", shape].join("|")).digest("hex").slice(0, 32);
}

export async function recordServerError(e: ServerErrorInput): Promise<void> {
  try {
    const clip = (v: string | null | undefined, n: number) => (v ? v.slice(0, n) : null);
    await db.insert(serverErrors).values({
      fingerprint: errorFingerprint(e),
      source: e.source,
      route: clip(e.route, 200),
      method: clip(e.method, 10),
      name: clip(e.name, 80),
      code: clip(e.code, 40),
      message: e.message.slice(0, 300),
      stack: clip(e.stack, 1200),
      lastRef: clip(e.ref, 20),
      lastDigest: clip(e.digest, 40),
    }).onConflictDoUpdate({
      target: serverErrors.fingerprint,
      set: {
        occurrences: sql`${serverErrors.occurrences} + 1`,
        lastSeen: sql`now()`,
        message: sql`excluded.message`,
        stack: sql`coalesce(excluded.stack, ${serverErrors.stack})`,
        lastRef: sql`coalesce(excluded.last_ref, ${serverErrors.lastRef})`,
        lastDigest: sql`coalesce(excluded.last_digest, ${serverErrors.lastDigest})`,
      },
    });
  } catch (err) {
    logEvent("server-error-unrecorded", { route: e.route ?? undefined, reason: err instanceof Error ? err.message.slice(0, 160) : "?" }, "warn");
  }
}

export interface ServerErrorRow {
  fingerprint: string;
  source: "REQUEST" | "ROUTE";
  route: string | null;
  method: string | null;
  name: string | null;
  code: string | null;
  message: string;
  lastRef: string | null;
  occurrences: number;
  firstSeen: Date;
  lastSeen: Date;
}

/** ما ظهر في آخر `days` يوماً — الأحدثُ أوّلاً. */
export async function loadRecentServerErrors(days: number, limit = 20): Promise<ServerErrorRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db.select({
    fingerprint: serverErrors.fingerprint, source: serverErrors.source, route: serverErrors.route,
    method: serverErrors.method, name: serverErrors.name, code: serverErrors.code, message: serverErrors.message,
    lastRef: serverErrors.lastRef, occurrences: serverErrors.occurrences,
    firstSeen: serverErrors.firstSeen, lastSeen: serverErrors.lastSeen,
  }).from(serverErrors).where(gte(serverErrors.lastSeen, since)).orderBy(desc(serverErrors.lastSeen)).limit(limit);
}
