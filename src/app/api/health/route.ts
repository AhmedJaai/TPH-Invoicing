/**
 * فحص صحّة النظام.
 *
 * يجيب عن السؤال الوحيد المهم وقت العطل: أي جزء لا يعمل؟
 * لا يكشف سرّاً — يقول «موجود» و«يعمل» لا القيم نفسها.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { selectedProviderName } from "@/lib/extraction/provider";
import { isAuthBypassed } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** يستخرج المضيف من سلسلة الاتصال بلا كلمة المرور. */
function dbHost(): { host: string; pooled: boolean } | null {
  const raw = process.env.DATABASE_URL;
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname;
    return { host, pooled: host.includes("-pooler") };
  } catch {
    return null;
  }
}

/**
 * الفحص العلنيّ مختصر عمداً.
 *
 * كانت الاستجابة تكشف مضيف القاعدة وحال تخطّي الدخول ووجود المفاتيح —
 * لمن يعرف الرابط ولو لم يدخل. وهذا استطلاعٌ مجّاني: يعرف المهاجم أين
 * القاعدة وهل الباب مفتوح. فصار غير الداخل يرى «حيّ أو غير حيّ» وحده،
 * والتفصيل لمن يملك `audit:view`.
 */
export async function GET() {
  const started = Date.now();
  const viewer = await currentUser().catch(() => null);
  const detailed = viewer !== null && can(viewer.role, "audit:view");
  const info = dbHost();

  let database: { ok: boolean; latencyMs?: number; error?: string };
  try {
    await db.execute(sql`select 1`);
    database = { ok: true, latencyMs: Date.now() - started };
  } catch (e) {
    database = { ok: false, error: (e as Error).message.slice(0, 160) };
  }

  const provider = selectedProviderName();
  const providerKeyPresent =
    provider === "gemini"
      ? Boolean(process.env.GEMINI_API_KEY)
      : provider === "claude"
        ? Boolean(process.env.ANTHROPIC_API_KEY)
        : true;

  const checks = {
    database,
    // النقطة المباشرة تستنفد حصّتها في البيئة السحابية فتقف الطلبات صامتة
    dbEndpoint: info ? { host: info.host, pooled: info.pooled } : { error: "DATABASE_URL غير مضبوط" },
    extraction: { provider, keyPresent: providerKeyPresent },
    google: {
      clientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      allowlistCount: (process.env.ALLOWED_EMAILS ?? "").split(",").filter(Boolean).length,
    },
    auth: { bypassed: isAuthBypassed() },
    drive: {
      foldersConfigured: Boolean(
        process.env.DRIVE_ACCOUNTS_FOLDER_ID && process.env.DRIVE_YEAR_2026_FOLDER_ID,
      ),
    },
  };

  const healthy =
    database.ok &&
    providerKeyPresent &&
    checks.google.clientConfigured &&
    checks.drive.foldersConfigured;

  if (!detailed) {
    return NextResponse.json(
      { healthy, at: new Date().toISOString() },
      { status: healthy ? 200 : 503 },
    );
  }

  return NextResponse.json(
    { healthy, checks, at: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
