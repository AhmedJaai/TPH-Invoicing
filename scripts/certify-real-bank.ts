/**
 * شهادةُ البيانات الحقيقية — كشوفُ البنك كما هي على قرص أحمد.
 *
 *   npm run ops:real-bank
 *
 * **لا يكتب شيئاً.** لا في القاعدة ولا في ملفّات أحمد. يقرأ الكشوف
 * ويشغّل عليها القارئَ والمزامنةَ نفسَهما اللذين يشغّلهما الاستيراد،
 * ثمّ يقول ما كان سيقع لو استُورد.
 *
 * ولماذا لا يكفي ما قبله: الاختبارات تُمرَّر مدخلاتٍ **مصنوعة** تحاكي
 * كشف الأهليّ، والشهادةُ المالية تجري على المخطّط الحقيقيّ ببياناتٍ
 * تُنشَأ لها. وكلاهما لا يُثبت أنّ ملفّ البنك الحقيقيّ يُقرأ: فيه
 * أوصافٌ ملتحمة، وأعمدةٌ تنتقل، ومراجعُ غير قياسية، وخصائصُ تصديرٍ
 * لا تُخترَع في اختبار.
 *
 * والبروتوكول — وهو ما طلبته المراجعة نصّاً:
 *
 *   ١. الملفّ مرّةً        → كم صفّاً · كم معروفاً · كم جديداً
 *   ٢. الملفّ نفسه ثانيةً  → المعروف كلُّه · لا جديد
 *   ٣. تصديرٌ آخر مختلف    → المعروف كلُّه · لا جديد
 *   ٤. كشفٌ أوسع يحوي القديم → القديم معروف · الفرق وحده جديد
 */
import { readFileSync, existsSync } from "node:fs";
import { and, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { bankTransactions } from "@/db/schema";
import { readStatementFile } from "@/services/statement-file.service";
import { toCanonical } from "@/lib/bank/canonical";
import { operationRef, operationRefs } from "@/lib/bank/identity";
import { beneficiaryKey, factKey, looseKey, syncRows, type KnownRow } from "@/lib/bank/sync";

const ROOT = "/Users/aj/Desktop/Invoices ";

/** الكشوف الحقيقية، مرتّبةً من الأضيق إلى الأوسع. */
const FILES = [
  {
    label: "أ · مايو ← أغسطس ٦",
    path: `${ROOT}/E-Statement_12600000942005_260505_260806_714557_1-1.xlsx`,
  },
  {
    label: "ب · تصديرٌ آخر · مايو ١٤ ← يونيو ٣٠",
    path: `${ROOT}/PublicHouse-Receipts-Organized/_Bank Statements/E-Statement_SNB_12600000942005_2026-05-14_to_2026-06-30.xlsx`,
  },
  {
    label: "ج · الأوسع · مايو ← سبتمبر ١",
    path: `${ROOT}/AUG Files /E-Statement_12600000942005_260505_260901_749055_1-1.xlsx`,
  },
  {
    label: "د · تصديرٌ رابع · مايو ٨ ← سبتمبر ١",
    path: `${ROOT}/_خاص - أحمد والمحاسب/Bank Statement 08-05 to 01-09-2026.xlsx`,
  },
];

interface Parsed {
  label: string;
  rows: { key: string; raw: Awaited<ReturnType<typeof readStatementFile>>["rows"][number]; tx: ReturnType<typeof toCanonical> }[];
  bank: string | null;
  account: string | null;
  warnings: number;
  blocked: string | null;
}

async function parse(label: string, path: string): Promise<Parsed | null> {
  if (!existsSync(path)) {
    console.log(`  ✕ ${label} — لا وجود للملفّ`);
    return null;
  }
  const buffer = readFileSync(path);
  const read = await readStatementFile(buffer, path.split("/").pop()!);
  return {
    label,
    bank: read.bank ?? null,
    account: read.accountNumber ?? null,
    warnings: read.warnings.length,
    blocked: read.blocked ?? null,
    rows: read.rows.map((r, i) => ({
      key: `row-${r.rowNumber}-${i}`,
      raw: r,
      tx: toCanonical({
        valueDate: r.valueDate,
        description: r.description,
        beneficiaryRaw: r.beneficiaryRaw,
        transactionType: r.transactionType,
        amountMinor: r.amountMinor,
        direction: r.direction,
      }),
    })),
  };
}

/** يحوّل صفوفاً مقروءة إلى «ما يعرفه النظام» — كما لو كانت مقيَّدة. */
function asKnown(p: Parsed, accountId: string | null): KnownRow[] {
  return p.rows.map((r, i) => ({
    id: `${p.label}#${i}`,
    accountId,
    refs: operationRefs(r.tx),
    operationRef: operationRef(r.tx),
    factKey: factKey(r.tx),
    looseKey: looseKey(r.tx),
    amountMinor: r.tx.amountMinor,
    direction: r.tx.direction,
    beneficiary: beneficiaryKey(r.tx),
  }));
}

function report(title: string, r: ReturnType<typeof syncRows>, expect?: string) {
  const line = `معروف ${String(r.known.length).padStart(4)} · جديد ${String(r.fresh.length).padStart(4)}`
    + ` · ملتبس ${String(r.ambiguous.length).padStart(3)} · تضارب ${String(r.conflict.length).padStart(3)}`;
  console.log(`  ${title}`);
  console.log(`      ${line}${expect ? `   ← المتوقَّع: ${expect}` : ""}`);
  for (const a of r.ambiguous.slice(0, 3)) {
    console.log(`        ملتبس: ${a.verdict.reason}`);
  }
  for (const c of r.conflict.slice(0, 3)) {
    console.log(`        تضارب: ${c.verdict.reason}`);
  }
}

async function main() {
  console.log("\n═══════════ شهادةُ الكشوف الحقيقية ═══════════\n");
  console.log("  لا يُكتَب شيء — لا في القاعدة ولا في ملفّاتك.\n");

  /* ── ١ · القراءة ── */
  console.log("── ١ · هل تُقرأ الملفّات أصلاً؟ ──\n");
  const parsed: Parsed[] = [];
  for (const f of FILES) {
    const p = await parse(f.label, f.path);
    if (!p) continue;
    parsed.push(p);
    const flag = p.blocked ? "✕" : p.rows.length === 0 ? "✕" : "✓";
    console.log(`  ${flag} ${p.label}`);
    console.log(
      `      ${String(p.rows.length).padStart(4)} حركة · بنك ${p.bank ?? "؟"}`
      + ` · حساب ${p.account ?? "لم يُقرأ"} · تحذيرات ${p.warnings}`
      + (p.blocked ? ` · محجوب: ${p.blocked}` : ""),
    );
  }

  if (parsed.length === 0) {
    console.log("\n  لا ملفّ يُقرأ — توقّفت الشهادة.\n");
    process.exit(1);
  }

  /* ── ٢ · البروتوكول ── */
  console.log("\n── ٢ · المزامنة: أهي عندنا؟ ──\n");

  const base = parsed[0];
  const ACC = "acct-real";

  report("أ · على قاعدةٍ فارغة", syncRows(base.rows.map((r) => ({ row: r, tx: r.tx })), [], ACC),
    `${base.rows.length} جديدة · صفر معروف`);

  report("ب · الملفّ نفسه ثانيةً", syncRows(
    base.rows.map((r) => ({ row: r, tx: r.tx })), asKnown(base, ACC), ACC,
  ), `${base.rows.length} معروفة · صفر جديد`);

  report("ج · وعشرون مرّة", syncRows(
    base.rows.map((r) => ({ row: r, tx: r.tx })), asKnown(base, ACC), ACC,
  ), "لا تتغيّر");

  for (const other of parsed.slice(1)) {
    const overlap = other.rows.filter((r) =>
      r.tx.valueDate >= new Date(Math.min(...base.rows.map((b) => b.tx.valueDate.getTime())))
      && r.tx.valueDate <= new Date(Math.max(...base.rows.map((b) => b.tx.valueDate.getTime())))).length;
    report(
      `د · ${other.label} مقابل «أ»`,
      syncRows(other.rows.map((r) => ({ row: r, tx: r.tx })), asKnown(base, ACC), ACC),
      `المشترك تقريباً ${overlap} معروف`,
    );
  }

  /* ── ٣ · مقابل القاعدة الحيّة ── */
  console.log("\n── ٣ · مقابل ما هو مقيَّدٌ فعلاً في قاعدتك ──\n");

  for (const p of parsed) {
    const times = p.rows.map((r) => r.tx.valueDate.getTime());
    if (times.length === 0) continue;

    const prior = await db
      .select({
        id: bankTransactions.id,
        valueDate: bankTransactions.valueDate,
        amountMinor: bankTransactions.amountMinor,
        direction: bankTransactions.direction,
        description: bankTransactions.description,
        transactionType: bankTransactions.transactionType,
        beneficiaryRaw: bankTransactions.beneficiaryRaw,
        bankAccountId: bankTransactions.bankAccountId,
        operationRef: bankTransactions.operationRef,
      })
      .from(bankTransactions)
      .where(and(
        gte(bankTransactions.valueDate, new Date(Math.min(...times))),
        lte(bankTransactions.valueDate, new Date(Math.max(...times))),
      ));

    const known: KnownRow[] = prior.map((r) => {
      const tx = toCanonical({
        valueDate: r.valueDate, description: r.description,
        beneficiaryRaw: r.beneficiaryRaw, transactionType: r.transactionType,
        amountMinor: r.amountMinor, direction: r.direction as "DEBIT" | "CREDIT",
      });
      return {
        id: r.id, accountId: r.bankAccountId,
        refs: operationRefs(tx), operationRef: r.operationRef ?? operationRef(tx),
        factKey: factKey(tx), looseKey: looseKey(tx),
        amountMinor: r.amountMinor, direction: r.direction as "DEBIT" | "CREDIT",
        beneficiary: beneficiaryKey(tx),
      };
    });

    const r = syncRows(p.rows.map((x) => ({ row: x, tx: x.tx })), known, null);
    report(`${p.label} (${prior.length} مقيَّدة في المدى)`, r,
      "لو استُورد الآن: الجديد وحده يُضاف");
  }

  console.log("\n═══════════════════════════════════════════════\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✕ توقّفت:", (e as Error).message, "\n");
  process.exit(1);
});
