/**
 * كشفُ البنك مقابلَ حركاتنا — ما عندنا في مدّته وليس فيه.
 *
 *   npx tsx --env-file=.env scripts/repair-bank-file.ts <ملف الكشف>                    معاينة لا تكتب
 *   npx tsx --env-file=.env scripts/repair-bank-file.ts <ملف الكشف> --i-know-this-is-production
 *
 * بإذن أحمد (٣ أكتوبر ٢٠٢٦، أرفق كشف ٥ مايو–٢٨ سبتمبر لفرق ١٫٧٣): رسومُ ٢ و٣ سبتمبر
 * دخلت مرّتين أيّامَ إعادة بناء الهويّة. والمزامنةُ نفسُها (`syncRows`) تقابل الملفّ، ثمّ
 * `storedMissingFromFile` تقول ما بقي عندنا بلا صفٍّ منه:
 *   - ما له **توأمٌ باقٍ** بالوقائع نفسها (مكرَّرٌ يقيناً) يُحفظ ويُحذف بـ`resolveHeldRow`
 *     — هو ومصروفُه، وبالسجلّ.
 *   - وما لا توأمَ له (حركةٌ لم تقع؟) يُحفظ وحده لقرار أحمد في صفحة البنك.
 * ويُعطي النتيجةَ نفسها إن شُغِّل مرّتين.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { readStatementFile } from "@/services/statement-file.service";
import { resolveBankAccount } from "@/services/bank-account.service";
import { holdRows, resolveHeldRow } from "@/services/bank-held.service";
import { toCanonical } from "@/lib/bank/canonical";
import { operationRef, operationRefs } from "@/lib/bank/identity";
import { beneficiaryKey, factKey, looseKey, storedMissingFromFile, syncRows, type KnownRow } from "@/lib/bank/sync";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const riyal = (m: number) => (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

async function main() {
  const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!path) throw new Error("مسارُ ملفّ الكشف مطلوب");
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");
  const parsed = await readStatementFile(readFileSync(path), basename(path));
  if (parsed.rows.length === 0) throw new Error("لم تُقرأ حركة");
  const accountId = await resolveBankAccount({ accountNumber: parsed.accountNumber, bankName: parsed.bank });
  console.log(`${basename(path)}: ${parsed.rows.length} حركة · ${parsed.periodStart?.toISOString().slice(0, 10)} → ${parsed.periodEnd?.toISOString().slice(0, 10)}`);

  const stored = (await db.execute<{
    id: string; value_date: string; amount_minor: number; direction: "DEBIT" | "CREDIT"; description: string | null;
    transaction_type: string | null; beneficiary_raw: string | null; bank_account_id: string | null; operation_ref: string | null; bank_import_id: string;
  }>(sql`select id, value_date, amount_minor, direction::text direction, description, transaction_type, beneficiary_raw, bank_account_id, operation_ref, bank_import_id from bank_transactions`)).rows
    .map((r) => ({ ...r, valueDate: new Date(r.value_date), bankAccountId: r.bank_account_id, amountMinor: r.amount_minor }));
  const canon = (r: (typeof stored)[number]) => toCanonical({ valueDate: r.valueDate, description: r.description, beneficiaryRaw: r.beneficiary_raw, transactionType: r.transaction_type, amountMinor: r.amount_minor, direction: r.direction });
  const known: KnownRow[] = stored.map((r) => {
    const tx = canon(r);
    return { id: r.id, accountId: r.bank_account_id, refs: operationRefs(tx), operationRef: r.operation_ref ?? operationRef(tx),
      factKey: factKey(tx), looseKey: looseKey(tx), amountMinor: r.amount_minor, direction: r.direction, beneficiary: beneficiaryKey(tx) };
  });
  const sync = syncRows(parsed.rows.map((r) => ({ row: r, tx: toCanonical(r) })), known, accountId);
  console.log(`في الملفّ ${parsed.rows.length} · عندنا منها ${sync.known.length} · جديدة ${sync.fresh.length} · ملتبسة ${sync.ambiguous.length} · متضاربة ${sync.conflict.length}`);
  const missing = storedMissingFromFile(stored, sync, { start: parsed.periodStart, end: parsed.periodEnd }, accountId);
  const net = missing.reduce((s, m) => s + (m.direction === "DEBIT" ? -m.amount_minor : m.amount_minor), 0);
  console.log(`عندنا وليست في الملفّ: ${missing.length} (أثرُها في الرصيد ${riyal(net)})`);

  const keyOf = new Map(known.map((k) => [k.id, k.factKey]));
  const claimed = new Set(sync.known.map((k) => k.verdict.matchedId));
  for (const m of missing) {
    /* مكرَّرٌ يقيناً: صفٌّ من الملفّ قابل توأمَه بالوقائع نفسها، فبقي هو زائداً */
    const twin = known.find((k) => k.id !== m.id && claimed.has(k.id) && k.factKey === keyOf.get(m.id));
    console.log(`  ${twin ? "مكرَّرة" : "بلا توأم"} · ${m.valueDate.toISOString().slice(0, 10)} · ${m.direction === "DEBIT" ? "صادر" : "وارد"} ${riyal(m.amount_minor)} · ${m.description ?? ""}`);
    if (!WRITE) continue;
    await holdRows([{
      kind: "MISSING_FROM_FILE", bankImportId: m.bank_import_id, bankAccountId: accountId, againstTransactionId: m.id,
      reason: twin ? "مكرَّرة: الكشفُ يذكرها مرّةً وهي عندنا مرّتين" : "عندنا وليست في كشف البنك الذي يغطّي يومها — مكرّرةٌ دخلت مرّتين، أو حركةٌ لم تقع",
      valueDate: m.valueDate, description: m.description, beneficiaryRaw: m.beneficiary_raw, transactionType: m.transaction_type,
      amountMinor: m.amount_minor, direction: m.direction, operationRef: m.operation_ref,
    }]);
    if (!twin) continue;
    const [held] = (await db.execute<{ id: string }>(sql`select id from bank_held_rows where kind = 'MISSING_FROM_FILE' and against_transaction_id = ${m.id} and resolved_at is null`)).rows;
    if (held) {
      await db.transaction((t) => resolveHeldRow(t, held.id, "REMOVED", AHMED));
      console.log("    ← حُذفت ومصروفُها");
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
