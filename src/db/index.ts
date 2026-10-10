import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { poolSize, requiresPooler } from "@/lib/ops/db-identity";

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
    /*
      على النقطة المجمَّعة بضعةُ اتّصالاتٍ لكلّ نسخة: باتّصالٍ واحد كان كلُّ
      `Promise.all` يجري واحداً بعد واحد، ومعاملةٌ طويلة (استيراد بنك) تحجز كلَّ
      صفحةٍ أخرى تخدمها النسخةُ نفسها. ويبقى «داخل المعاملة اكتب بـ`t`» قائماً:
      `db` داخلها يكتب **خارج** المعاملة على اتّصالٍ آخر.
    */
    max: poolSize(process.env, process.env.DATABASE_URL),
    // ينتهي الانتظار بخطأ مفهوم بدل الوقوف إلى الأبد
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    // استعلام عالق لا يجوز أن يحتجز الاتصال أكثر من نصف دقيقة
    statement_timeout: 30_000,
    query_timeout: 30_000,
  });

if (!isServerless) globalThis.__tphPool = pool;

/*
  اتّصالٌ خامل تقطعه القاعدة (أو يعود من تعليق الدالّة مقطوعاً) يرفع `error` على
  التجمّع — وبلا سامعٍ يُسقط العمليّةَ كلَّها. فيُسجَّل ويُترَك للتجمّع أن يفتح غيره.
*/
if (pool.listenerCount("error") === 0) {
  pool.on("error", (e) => {
    console.error(JSON.stringify({ kind: "db-idle-connection-error", message: e.message }));
  });
}

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
