/**
 * يكتب يومَ فتح الحساب البنكيّ (059) — ما قبله في شهره لا يُعدّ «بلا كشف» في الإقفال.
 *
 *   npx tsx --env-file=.env scripts/set-bank-opened-on.ts <رقم الحساب> <YYYY-MM-DD> [--i-know-this-is-production]
 *
 * أحمد (٣ أكتوبر ٢٠٢٦): فُتح حسابُ الأهلي ····2005 في مايو، وأوّلُ حركةٍ فيه ٨ مايو — فكان
 * إقفالُ مايو يُردّ بسبعة أيّامٍ قبل وجود الحساب.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bankAccounts } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";

async function main() {
  const [number, day] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!number || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) throw new Error("الاستعمال: <رقم الحساب> <YYYY-MM-DD>");
  const [acc] = await db.select().from(bankAccounts).where(eq(bankAccounts.accountNumber, number));
  if (!acc) throw new Error("لا حسابَ بهذا الرقم");
  console.log(`${acc.label}: يومُ الفتح ${acc.openedOn ?? "غير مكتوب"} ← ${day}${WRITE ? "" : " (معاينة)"}`);
  if (!WRITE) process.exit(0);
  await db.update(bankAccounts).set({ openedOn: day }).where(eq(bankAccounts.id, acc.id));
  await recordAudit({ actorId: AHMED, action: "BANK_ACCOUNT_UPDATED", entityType: "bank_account", entityId: acc.id,
    before: { يوم_الفتح: acc.openedOn }, after: { يوم_الفتح: day, السبب: "فُتح الحساب في هذا اليوم — ما قبله في شهره لا يُطلب له كشف (أحمد)" } });
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
