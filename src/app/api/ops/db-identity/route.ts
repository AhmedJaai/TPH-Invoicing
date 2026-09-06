/**
 * بصمةُ القاعدة التي تراها هذه البيئة.
 *
 * الغرض واحد: **إثبات** أنّ المعاينة لا تكتب في الإنتاج. ولا يكفي أن
 * نفترض ذلك — يُفتَح هذا المسار في البيئتين ويُقارَن الجوابان.
 *
 * ولا يُرجع سلسلة الاتصال ولا كلمة سرّ ولا اسم مستخدم: المضيفَ واسمَ
 * القاعدة ومعرّفَ العنقود وحدها. ومعرّف العنقود هو الحاكم — المضيف
 * يخدع، فلنقطة Neon الواحدة أسماءٌ مجمَّعة وغيرُ مجمَّعة.
 *
 * ومحروسٌ بصلاحية التدقيق: هويّةُ البنية التحتية ليست معلومةً عامّة.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { guard, respondTo } from "@/services/guard";
import {
  connectionWarnings, environmentOf, parseConnection,
} from "@/lib/ops/db-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await guard("ops-db-identity", "audit:view");
  } catch (e) {
    const mapped = respondTo(e);
    if (mapped) return mapped;
    throw e;
  }

  const conn = parseConnection(process.env.DATABASE_URL);
  const [row] = (
    await db.execute<{ id: string; name: string }>(sql`
      select (pg_control_system()).system_identifier::text as id,
             current_database() as name
    `)
  ).rows;

  const print = {
    host: conn.host,
    database: row?.name ?? conn.database,
    systemIdentifier: String(row?.id ?? ""),
    pooled: conn.pooled,
    environment: environmentOf(process.env),
  };

  return NextResponse.json({
    ...print,
    warnings: connectionWarnings(print),
    note:
      "قارن `systemIdentifier` بين الإنتاج والمعاينة. تطابقُه يعني " +
      "قاعدةً واحدة تخدم البيئتين — وكلُّ نشرٍ تجريبيّ يكتب في مالٍ حقيقيّ.",
  });
}
