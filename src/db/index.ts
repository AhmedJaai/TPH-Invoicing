import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { requiresPooler } from "@/lib/ops/db-identity";

declare global {
  var __tphPool: Pool | undefined;
}

/**
 * تجمّع الاتصالات.
 *
 * درسان مدفوع ثمنهما: استعمال نقطة اتصال Neon المباشرة في بيئة سحابية
 * يستنفد حصّة الاتصالات فتقف الطلبات، ولأنّ pg ينتظر اتصالاً حرّاً بلا مهلة
 * افتراضية فالوقوف يكون **صامتاً بلا خطأ** — وهو أسوأ أنواع الأعطال.
 *
 * لذلك: نقطة مجمَّعة (pooler) في سلسلة الاتصال، ومهلة صريحة لكل شيء.
 */
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

const pool =
  globalThis.__tphPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    // كل استدعاء سحابي يخدم طلباً واحداً، فاتصال واحد يكفيه ولا يزاحم غيره
    max: isServerless ? 1 : 10,
    // ينتهي الانتظار بخطأ مفهوم بدل الوقوف إلى الأبد
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    // استعلام عالق لا يجوز أن يحتجز الاتصال أكثر من نصف دقيقة
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });

if (!isServerless) globalThis.__tphPool = pool;

/*
  والنقطة المجمَّعة لا تُفرَض بالوثيقة وحدها: سطرٌ في السجلّ عند كلّ بدء
  تشغيلٍ سحابيّ على النقطة المباشرة، و`/api/health` يُسقط الحكم بها.
  ولا يُرمى: قاعدةٌ تعمل ببطء خيرٌ من موقعٍ لا يفتح.
*/
{
  const pooler = requiresPooler(process.env, process.env.DATABASE_URL);
  if (pooler.violation) {
    console.error(JSON.stringify({ kind: "db-not-pooled", message: "DATABASE_URL يشير إلى نقطة Neon غير المجمَّعة في بيئة سحابيّة" }));
  }
}

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { schema };
