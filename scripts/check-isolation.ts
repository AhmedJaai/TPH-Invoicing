/**
 * هل تكتب بيئةُ المعاينة في بيانات الإنتاج؟
 *
 *   npm run ops:isolation                 # يطبع بصمةَ القاعدة الحالية
 *   npm run ops:isolation -- prints.json  # يقارن بصماتٍ جُمعت
 *
 * لا يعدّل شيئاً. ولا يطبع سلسلة الاتصال أبداً — هي تحمل كلمة سرّ
 * القاعدة، وطباعتها في سجلٍّ تُسرّبها إلى كلّ من يقرأ السجلّ.
 *
 * **والعزل لا يُثبَت من هنا وحده.** هذا يقرأ القاعدة التي تراها هذه
 * البيئة. ولإثبات العزل تُجمَع بصمةُ الإنتاج وبصمةُ المعاينة — من
 * `/api/ops/db-identity` في كلٍّ منهما — ثمّ تُقارَنان.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  checkIsolation, connectionWarnings, environmentOf, parseConnection,
  type DbFingerprint,
} from "@/lib/ops/db-identity";

export async function fingerprint(): Promise<DbFingerprint> {
  const conn = parseConnection(process.env.DATABASE_URL);
  const [row] = (
    await db.execute<{ id: string; name: string }>(sql`
      select (pg_control_system()).system_identifier::text as id,
             current_database() as name
    `)
  ).rows;

  return {
    host: conn.host,
    database: row?.name ?? conn.database,
    systemIdentifier: String(row?.id ?? ""),
    pooled: conn.pooled,
    environment: environmentOf(process.env),
  };
}

async function main() {
  const print = await fingerprint();

  console.log("\n═══════════ هويّة القاعدة ═══════════\n");
  console.log(`  البيئة        : ${print.environment}`);
  console.log(`  المضيف        : ${print.host}`);
  console.log(`  القاعدة       : ${print.database}`);
  console.log(`  معرّف العنقود : ${print.systemIdentifier}`);
  console.log(`  مجمَّعة        : ${print.pooled ? "نعم" : "لا"}`);

  for (const w of connectionWarnings(print)) console.log(`\n  ⚠ ${w}`);

  /*
    التطوير على قاعدة الإنتاج يكتب في مال المقهى — هكذا كتبت الشهادة
    مورّداً وفاتورةً ودفعتين. فإن أُقِرّ معرّفُ الإنتاج في
    ops-attestation.json وطابقه معرّفُ هذه البيئة وهي تطوير: يُرفَض صراحةً.
  */
  let productionId: string | undefined;
  try {
    productionId = (JSON.parse(readFileSync("ops-attestation.json", "utf8")) as {
      isolationVerified?: { productionId?: string };
    }).isolationVerified?.productionId;
  } catch {
    productionId = undefined;
  }
  if (print.environment === "development") {
    if (productionId && productionId === print.systemIdentifier) {
      console.log("\n  ✕ هذه بيئة تطوير وقاعدتها قاعدةُ الإنتاج — كلّ تجربةٍ هنا تكتب في المال الحقيقيّ.");
      console.log("    افتح فرعاً في Neon وضع DATABASE_URL الخاصّ به في .env.local.\n");
      process.exit(1);
    }
    if (!productionId) {
      console.log("\n  ⚠ معرّف الإنتاج غير مُقَرّ في ops-attestation.json — فلا يُعرف أهذه القاعدة هي الإنتاج.");
    }
  }

  const file = process.argv[2];
  if (file) {
    const collected = JSON.parse(readFileSync(file, "utf8")) as DbFingerprint[];
    const verdict = checkIsolation([...collected, print]);
    console.log("\n═══════════ حكم العزل ═══════════\n");
    console.log(`  ${verdict.verdict}: ${verdict.reason}\n`);
    process.exit(verdict.verdict === "SHARED" ? 1 : 0);
  }

  console.log(
    "\n  للإثبات: افتح /api/ops/db-identity في الإنتاج وفي المعاينة،" +
    "\n  واحفظ الجوابين في ملفٍّ واحد مصفوفةً، ثمّ:" +
    "\n    npm run ops:isolation -- prints.json\n",
  );
  process.exit(0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
