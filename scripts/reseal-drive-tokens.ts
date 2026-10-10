/**
 * يُعيد ختمَ رموز الدرايف المحفوظة بالمفتاح الجاري — بلا انتظار دخولٍ جديد.
 *
 *   npx tsx --env-file=.env scripts/reseal-drive-tokens.ts [--i-know-this-is-production]
 *
 * يلزم بعد أمرين: ضبطِ `TOKEN_ENCRYPTION_KEY` أوّلَ مرّة (الرموز القائمة خامٌّ حتى يدخل
 * صاحبُها)، وتدويرِه (القديم في `TOKEN_ENCRYPTION_KEY_PREVIOUS`). بلا العلم يعدّ ولا يكتب.
 * ولا يطبع رمزاً ولا جزءاً منه. ويُعطي النتيجة نفسها إن شُغِّل مرّتين: المختومُ بالجاري يُترك.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { isSealed, resealToken, sealedWithCurrentKey, tokenEncryptionEnabled } from "@/lib/token-crypto";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();

async function main() {
  if (!tokenEncryptionEnabled()) {
    throw new Error("TOKEN_ENCRYPTION_KEY غير مضبوط (٣٢ حرفاً فأكثر) — لا مفتاحَ يُختم به");
  }
  const rows = await db
    .select({ provider: accounts.provider, providerAccountId: accounts.providerAccountId, token: accounts.refresh_token })
    .from(accounts)
    .where(and(eq(accounts.provider, "google"), isNotNull(accounts.refresh_token)));

  let raw = 0, old = 0, current = 0, written = 0, unreadable = 0;
  for (const row of rows) {
    if (!row.token) continue;
    if (sealedWithCurrentKey(row.token)) { current++; continue; }
    if (isSealed(row.token)) old++; else raw++;
    let next: string;
    try {
      next = resealToken(row.token);
    } catch {
      /* مختومٌ بمفتاحٍ لا نملكه — يُترك كما هو، وصاحبُه يدخل من جديد */
      unreadable++;
      continue;
    }
    if (!WRITE) continue;
    await db.update(accounts).set({ refresh_token: next }).where(and(
      eq(accounts.provider, row.provider),
      eq(accounts.providerAccountId, row.providerAccountId),
      /* لا يُكتب فوق رمزٍ تغيّر منذ قُرئ (دخولٌ وقع أثناء التشغيل) */
      eq(accounts.refresh_token, row.token),
    ));
    written++;
  }
  console.log(
    `رموز الدرايف: ${rows.length} — مختومٌ بالجاري ${current} · خامّ ${raw} · بصيغةٍ أو مفتاحٍ سابق ${old} · لا يُفكّ ${unreadable}` +
    (WRITE ? ` · أُعيد ختمُه ${written}` : " (معاينة — لم يُكتب شيء)"),
  );
  process.exit(0);
}

main().catch((e) => { console.error("✕", (e as Error).message); process.exit(1); });
