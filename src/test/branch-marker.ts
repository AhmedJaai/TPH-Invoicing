/**
 * قبل أوّل اختبار قاعدة: أهذه القاعدةُ البعيدة فرعُ الاختبار حقّاً؟
 *
 * القاعدةُ المحلّيّة (`*_test` على الجهاز أو خدمة CI) لا يُسأل عنها شيء ولا يُفتَح
 * لها اتّصالٌ هنا. أمّا فرعُ Neon فيُطلَب فيه جدولُ العلَم: يُنشأ بيدٍ في الفرع
 * وحده، فلا يحمله الإنتاج، وفرعٌ أُعيد من أصله يفقده فيُرفَض حتى يُعاد العلَم.
 * اسمُ المضيف يُكتَب خطأً؛ والعلَمُ لا يوجد خطأً.
 *
 * يُستدعى من `vitest.db.config.mts` قبل أن يُحمَّل ملفّ اختبار — فالاستيرادُ
 * نسبيّ لا بـ`@/`: الإعدادُ يُحمَّل قبل أن تُعرَف الأسماء المستعارة.
 */
import { needsBranchMarker, TEST_BRANCH_MARKER } from "../lib/ops/test-database";

export async function assertTestBranchMarker(url: string | undefined): Promise<void> {
  if (!needsBranchMarker(url)) return;

  const { Client } = await import("pg");
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const found = await client.query<{ marker: string | null }>(
      "select to_regclass($1)::text as marker",
      [`public.${TEST_BRANCH_MARKER}`],
    );
    if (!found.rows[0]?.marker) {
      throw new Error(
        `✕ لا جدولَ علَمٍ «${TEST_BRANCH_MARKER}» في هذه القاعدة — فلا دليل أنّها فرعُ الاختبار لا الإنتاج.\n` +
        `  في محرّر SQL لفرع الاختبار وحده:  create table ${TEST_BRANCH_MARKER} ();\n` +
        "  (انظر docs/decisions/engineering-ops.md ← «اختبارات القاعدة على فرع Neon»)",
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
