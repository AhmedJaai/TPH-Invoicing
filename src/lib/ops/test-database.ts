/**
 * أيّ قاعدةٍ يجوز أن تلمسها اختبارات القاعدة؟
 *
 * `.env` يشير إلى الإنتاج، ولا قاعدةَ تطويرٍ منفصلة. واختبارٌ يكتب — ولو في
 * معاملةٍ تُلغى — يترك أثراً في سجلّ التدقيق إن سقط الإلغاء، والسجلّ لا
 * يُحذَف منه شيء. فالاختبارات لا تقرأ `DATABASE_URL` أبداً، بل
 * `TEST_DATABASE_URL`، ولا تقبله إلّا بشرطين معاً:
 *
 *   - المضيف محلّيّ (الجهاز أو خدمة CI) — لا نطاقَ سحابيّاً يشبه الإنتاج.
 *   - اسم القاعدة ينتهي بـ`_test` — فقاعدةٌ محلّيّة منسوخة من الإنتاج لا تُمَسّ.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

export function testDatabaseProblem(url: string | undefined): string | null {
  if (!url) return "TEST_DATABASE_URL غير مضبوط — اختبارات القاعدة لا تقرأ DATABASE_URL";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "TEST_DATABASE_URL ليس سلسلة اتّصالٍ صالحة";
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return "TEST_DATABASE_URL ليس سلسلة Postgres";
  if (!LOCAL_HOSTS.has(parsed.hostname)) return `المضيف ${parsed.hostname} ليس محلّيّاً`;
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name.endsWith("_test")) return `القاعدة «${name}» لا ينتهي اسمها بـ_test`;
  return null;
}
