/**
 * أيّ قاعدةٍ يجوز أن تلمسها اختبارات القاعدة؟
 *
 * `.env` يشير إلى الإنتاج، ولا قاعدةَ تطويرٍ منفصلة. واختبارٌ يكتب — ولو في
 * معاملةٍ تُلغى — يترك أثراً في سجلّ التدقيق إن سقط الإلغاء، والسجلّ لا
 * يُحذَف منه شيء. فالاختبارات لا تقرأ `DATABASE_URL` أبداً، بل
 * `TEST_DATABASE_URL`، ولا تقبله إلّا بأحد طريقين — واسمُ القاعدة ينتهي
 * بـ`_test` في كليهما، فقاعدةٌ منسوخة من الإنتاج لا تُمَسّ:
 *
 * **محلّيّة** — المضيف محلّيّ (الجهاز أو خدمة CI)، لا نطاقَ سحابيّاً يشبه الإنتاج.
 *
 * **فرعُ Neon للاختبار** — لمن لا Postgres على جهازه، وعلى إصدار الإنتاج نفسه.
 * شرطُ الاسم (`*_test`) قائمٌ فيه أيضاً — قاعدةُ الإنتاج `neondb` لا تمرّ — ومعه:
 *   - `TEST_DATABASE_NEON_ENDPOINT` يسمّي نقطةَ الفرع (`ep-…`) **بعينها**، والمضيفُ
 *     يبدأ بها. فسلسلةُ الإنتاج لا تمرّ بسهوٍ واحد: يلزم أن يُكتب معرّفُ نقطتها
 *     في متغيّرٍ اسمُه «اختبار».
 *   - وفي الفرع جدولُ العلَم `TEST_BRANCH_MARKER` — يُفحَص عند بدء التشغيل
 *     (`src/test/branch-marker.ts`). الإنتاج لا يحمله، وفرعٌ أُعيد من أصله يفقده.
 *     وهو الإثباتُ الذي تطلبه `engineering-ops.md`: العزلُ يُثبَت بعلَمٍ في الفرع
 *     لا يراه الإنتاج، لا باسم مضيف.
 *
 * والطريقة خطوةً خطوة في `docs/decisions/engineering-ops.md` ← «اختبارات القاعدة
 * على فرع Neon».
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

/** جدولٌ فارغ يُنشأ بيدٍ في فرع الاختبار وحده — وجودُه إذنُ الكتابة فيه. */
export const TEST_BRANCH_MARKER = "tph_test_branch_marker";

export interface TestDatabaseEnv {
  TEST_DATABASE_NEON_ENDPOINT?: string | undefined;
}

/** معرّف نقطة Neon من المضيف — بلا لاحقة المجمِّع: `ep-x-pooler.c-2…` ← `ep-x`. */
export function neonEndpointOf(hostname: string): string | null {
  if (!hostname.endsWith(".neon.tech")) return null;
  const first = hostname.split(".")[0].replace(/-pooler$/, "");
  return /^ep-[a-z0-9-]+$/.test(first) ? first : null;
}

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** أهي قاعدةٌ بعيدة يلزمها فحصُ العلَم قبل أوّل اختبار؟ */
export function needsBranchMarker(url: string | undefined): boolean {
  const parsed = parse(url);
  return parsed !== null && !LOCAL_HOSTS.has(parsed.hostname);
}

export function testDatabaseProblem(url: string | undefined, env: TestDatabaseEnv = {}): string | null {
  if (!url) return "TEST_DATABASE_URL غير مضبوط — اختبارات القاعدة لا تقرأ DATABASE_URL";
  const parsed = parse(url);
  if (!parsed) return "TEST_DATABASE_URL ليس سلسلة اتّصالٍ صالحة";
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) return "TEST_DATABASE_URL ليس سلسلة Postgres";

  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    const acknowledged = env.TEST_DATABASE_NEON_ENDPOINT?.trim();
    if (!acknowledged) return `المضيف ${parsed.hostname} ليس محلّيّاً`;
    const endpoint = neonEndpointOf(parsed.hostname);
    if (endpoint === null) return `المضيف ${parsed.hostname} ليس محلّيّاً ولا نقطةَ Neon`;
    if (endpoint !== acknowledged.replace(/-pooler$/, "")) {
      return `TEST_DATABASE_NEON_ENDPOINT يسمّي «${acknowledged}» والسلسلة تشير إلى «${endpoint}» — ليست فرعَ الاختبار المُقَرّ`;
    }
  }

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!name.endsWith("_test")) return `القاعدة «${name}» لا ينتهي اسمها بـ_test`;
  return null;
}
