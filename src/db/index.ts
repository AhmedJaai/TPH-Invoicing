import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  var __tphPool: Pool | undefined;
}

/**
 * تجمّع اتصالات واحد يُعاد استخدامه عبر إعادة التحميل الساخن في التطوير،
 * وإلا استُنفدت حصة اتصالات Neon بعد بضع تعديلات.
 */
const pool =
  globalThis.__tphPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") globalThis.__tphPool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { schema };
