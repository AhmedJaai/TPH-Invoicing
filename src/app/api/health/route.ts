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
import { activeProviderName } from "@/lib/extraction";
import { deepseekBaseUrl, deepseekKey } from "@/lib/ai/models";
import { createOAuthClient } from "@/lib/drive";
import { openToken } from "@/lib/token-crypto";
import { accounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isAuthBypassed } from "@/lib/session";
import { requiresPooler } from "@/lib/ops/db-identity";

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

  const provider = activeProviderName();
  const providerKeyPresent =
    provider === "deepseek"
      ? Boolean(process.env.DEEPSEEK_API_KEY)
      : provider === "gemini"
        ? Boolean(process.env.GEMINI_API_KEY)
        : provider === "claude"
          ? Boolean(process.env.ANTHROPIC_API_KEY)
          : true;

  const checks = {
    database,
    // النقطة المباشرة تستنفد حصّتها في البيئة السحابية فتقف الطلبات صامتة
    dbEndpoint: info
      ? { host: info.host, pooled: info.pooled, poolerRequired: requiresPooler(process.env, process.env.DATABASE_URL).serverless }
      : { error: "DATABASE_URL غير مضبوط" },
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
    // في السحابة على نقطة Neon المباشرة: يعمل اليوم ويقف صامتاً غداً
    !requiresPooler(process.env, process.env.DATABASE_URL).violation &&
    providerKeyPresent &&
    checks.google.clientConfigured &&
    checks.drive.foldersConfigured;

  /*
    وجودُ المفتاح غيرُ صلاحيّته. كان الفحص يقول «سليم» والرصيدُ صفر أو
    المفتاح مُلغى — فلا يُعرف العطب إلّا حين تسقط أوّل فاتورة. فللمخوَّل
    وحده (لئلّا يُستنزَف بطلباتٍ مجهولة) يُسأل المزوّد: أيعرف هذا المفتاح؟
  */
  let providerReachable: { ok: boolean; status?: number; error?: string } | undefined;
  if (detailed && provider === "deepseek" && providerKeyPresent) {
    try {
      const res = await fetch(`${deepseekBaseUrl()}/models`, {
        headers: { Authorization: `Bearer ${deepseekKey()}` },
        signal: AbortSignal.timeout(5_000),
      });
      providerReachable = { ok: res.ok, status: res.status };
    } catch (e) {
      providerReachable = { ok: false, error: (e as Error).name };
    }
  }

  /*
    ورمزُ الدرايف: كان منتهياً والمزامنة تقول «لا جديد» والفحص أخضر.
    فللمخوَّل وحده يُجدَّد رمزُه — قراءةٌ لا تمسّ الأرشيف.
  */
  let driveToken: { ok: boolean; error?: string } | undefined;
  if (detailed && viewer) {
    const [row] = await db
      .select({ token: accounts.refresh_token })
      .from(accounts)
      .where(and(eq(accounts.userId, viewer.id), eq(accounts.provider, "google")))
      .limit(1);
    if (!row?.token) {
      driveToken = { ok: false, error: "لا رمز درايف لهذا الحساب" };
    } else {
      try {
        const client = createOAuthClient();
        client.setCredentials({ refresh_token: openToken(row.token) });
        const t = await client.getAccessToken();
        driveToken = t.token ? { ok: true } : { ok: false, error: "لم يصدر رمز وصول" };
      } catch (e) {
        driveToken = { ok: false, error: (e as Error).message.slice(0, 80) };
      }
    }
  }

  if (!detailed) {
    return NextResponse.json(
      { healthy, at: new Date().toISOString() },
      { status: healthy ? 200 : 503 },
    );
  }

  /* المستطلِع يقرأ الرمز لا الجسم: قارئٌ معطَّل أو رمزُ درايف منتهٍ = 503 */
  const overall = healthy && (providerReachable?.ok ?? true) && (driveToken?.ok ?? true);
  return NextResponse.json(
    {
      healthy: overall,
      checks: { ...checks, providerReachable, driveToken },
      at: new Date().toISOString(),
    },
    { status: overall ? 200 : 503 },
  );
}
