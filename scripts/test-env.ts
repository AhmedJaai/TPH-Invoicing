/**
 * بيئةُ الاختبار: التطبيقُ كاملاً على نسخةٍ من بيانات الإنتاج، يُضغط فيه
 * كلُّ زرٍّ ولا يُمسّ المقهى.
 *
 *   npm run test-env -- dev [port]   خادمُ تطويرٍ على فرع «test» (الافتراضيّ ٣١٠٠)، ووضعُ التجربة
 *   npm run test-env -- start [port] نسخةُ الإنتاج المبنيّة (`next build` أوّلاً) — أسرع للزاحف بعشرة أضعاف
 *   npm run test-env -- reset        يعيد الفرعَ نسخةً من الإنتاج الآن (يمحو ما كُتب فيه)
 *   npm run test-env -- status       الفرعُ ومتى نُسخ آخرَ مرّة
 *
 * الوجهةُ في `.env.test` (غير متتبَّع): `TEST_DATABASE_URL` · `TEST_NEON_BRANCH_ID`.
 * والمفاتيحُ الأخرى (الذكاء، فودكس) من `.env` كما هي؛ والكتابةُ على الدرايف
 * في الإنتاج وحده (`drive-readonly.ts`) فلا تقع من هنا.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { resettableBranch, testDatabaseProblem } from "./lib/test-env";

const PROJECT = "dry-waterfall-11346444";
const PRODUCTION_BRANCH = "br-twilight-voice-aeaetbk8";

function readEnv(file: string): Record<string, string> {
  return existsSync(file) ? parse(readFileSync(file)) : {};
}

const base = readEnv(".env");
const local = readEnv(".env.local");
const test = readEnv(".env.test");
const [cmd = "dev", arg] = process.argv.slice(2);

function fail(msg: string): never {
  console.error(`\n✕ ${msg}\n`);
  process.exit(1);
}

async function neon(path: string, init?: RequestInit): Promise<unknown> {
  const key = process.env.NEON_API_KEY ?? local.NEON_API_KEY ?? base.NEON_API_KEY;
  if (!key) fail("لا مفتاحَ لواجهة Neon (`NEON_API_KEY` في `.env.local`).");
  const res = await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) fail(`ردّت Neon بـ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (cmd === "dev" || cmd === "start") {
    const problem = testDatabaseProblem(test.TEST_DATABASE_URL, base.DATABASE_URL);
    if (problem) fail(problem);
    const port = arg ?? "3100";
    /* المتغيّرُ القائم يغلب ملفّاتِ Next (`.env.local` · `.env`) — فالوجهةُ وحدها تتبدّل */
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: test.TEST_DATABASE_URL,
      PREVIEW_DATABASE_URL: test.TEST_DATABASE_URL,
      AUTH_BYPASS: "true",
      AUTH_URL: `http://localhost:${port}`,
    };
    delete env.VERCEL_ENV;
    /* البناءُ المحلّيّ إنتاجٌ في NODE_ENV — ووضعُ التجربة يتبع VERCEL_ENV حيث وُجد (preview-mode.ts) */
    if (cmd === "start") env.VERCEL_ENV = "preview";
    console.log(`بيئةُ الاختبار على http://localhost:${port} — فرع «test»، لا الإنتاج.`);
    const child = spawn("npx", ["next", cmd, "-p", port], { env, stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  }

  const branch = test.TEST_NEON_BRANCH_ID;
  const problem = resettableBranch(branch, PRODUCTION_BRANCH);
  if (problem) fail(problem);

  if (cmd === "status") {
    const r = (await neon(`/branches/${branch}`)) as { branch: { name: string; parent_id: string; last_reset_at?: string; created_at: string } };
    console.log(`الفرع «${r.branch.name}» (${branch}) من ${r.branch.parent_id}`);
    console.log(`آخرُ نسخٍ من الإنتاج: ${r.branch.last_reset_at ?? r.branch.created_at}`);
    return;
  }

  if (cmd === "reset") {
    const r = (await neon(`/branches/${branch}`)) as { branch: { name: string } };
    if (r.branch.name !== "test") fail(`الفرع ${branch} اسمُه «${r.branch.name}» لا «test» — لا يُعاد.`);
    /* «restore» من الأب بلا اسمٍ محفوظ: الفرعُ يصير الإنتاجَ الآن، وما كُتب فيه يُمحى */
    await neon(`/branches/${branch}/restore`, { method: "POST", body: JSON.stringify({ source_branch_id: PRODUCTION_BRANCH }) });
    console.log("أُعيد فرعُ «test» نسخةً من الإنتاج الآن. أعِد تشغيل الخادم إن كان يعمل.");
    return;
  }

  fail(`أمرٌ غير معروف «${cmd}». المتاح: dev · start · reset · status`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
