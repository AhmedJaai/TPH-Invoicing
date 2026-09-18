/**
 * طبقاتٌ بُنيت ولم يمرّ عليها صفّ — تُملأ من البيانات القائمة.
 *
 *   npm run db:backfill-layers -- [--statement <ملفّ الكشف>]... [--drive]
 *   npm run db:backfill-layers -- … --apply --i-know-this-is-production
 *
 * «من يبني طبقةً جديدة يُعيد تشغيلها على البيانات القائمة في الكوميت نفسه،
 * وإلّا فهي دعوى.» وقاست مراجعة سبتمبر: `reconciliation_periods` صفر،
 * و`bank_imports.bank_account_id` صفر من اثنين، و`documents.text_source`
 * سبعةٌ من ١٧٥. فالإقفال يمنع كلّ شهرٍ مضى لأنّ رصيديه مجهولان، ولا يُعرف
 * كم من الأرشيف يتوقّف إن سُحب نموذج الرؤية.
 *
 * ثلاثة أعمال، وبلا `--apply` يعرض ولا يكتب:
 *
 *   ١. حساب الاستيراد: من حركاته — إن كان لها حسابٌ واحد لا غير.
 *   ٢. فترات التسوية: `bank_transactions` لا يحفظ عمود الرصيد، فالكشف الأصليّ
 *      يُمرَّر بـ`--statement` ويُقرأ بالقارئ نفسه، ويُنسب إلى استيراده ببصمة
 *      الملفّ — أو باسمه إن وُجد أكثرُ صفوفه في حركات ذلك الاستيراد. ثمّ
 *      `monthBalancesFromStatement` نفسها: ما لا تستقيم سلسلته يبقى مجهولاً.
 *   ٣. مصدر القراءة: `resolveDocumentInput` بلا نداء نموذج. الصورة تُعرف من
 *      نوعها، والـPDF يحتاج ملفّه: بـ`--drive` يُنزَّل قراءةً فقط، وبلاه يُعدّ.
 *      وما لا يُقرأ يبقى فارغاً ويُعدّ — المجهول لا يُكتب قيمة.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { bankImports, documents, reconciliationPeriods } from "@/db/schema";
import { fileFingerprint } from "@/lib/bank/identity";
import { monthBalancesFromStatement } from "@/lib/bank/statement-balances";
import { PDF_TYPE, resolveDocumentInput } from "@/lib/ai/document-input";
import { downloadFile, driveForCli } from "@/lib/drive";
import { readStatementFile } from "@/services/statement-file.service";
import { assertWriteAllowed } from "./lib/guard-write";

const apply = process.argv.includes("--apply");
const useDrive = process.argv.includes("--drive");
const statementPaths = process.argv.flatMap((a, i, all) => (all[i - 1] === "--statement" ? [a] : []));

/** نسبة صفوف الكشف الموجودة في الاستيراد كي يُنسب إليه باسمه وحده. */
const NAME_MATCH_MIN_SHARE = 0.9;

type TextSource = "TEXT" | "PDF_EMBEDDED" | "DIRECT";

async function importAccounts() {
  const rows = (await db.execute<{ id: string; file_name: string; accounts: string[] }>(sql`
    select b.id, b.file_name,
           coalesce(array_agg(distinct t.bank_account_id) filter (where t.bank_account_id is not null), '{}') accounts
      from bank_imports b left join bank_transactions t on t.bank_import_id = b.id
     where b.bank_account_id is null
     group by b.id, b.file_name
  `)).rows;
  const plan = rows.filter((r) => r.accounts.length === 1).map((r) => ({ id: r.id, accountId: r.accounts[0], fileName: r.file_name }));
  const ambiguous = rows.filter((r) => r.accounts.length !== 1);
  return { plan, ambiguous };
}

async function statementPeriods() {
  const imports = await db
    .select({ id: bankImports.id, fileName: bankImports.fileName, sha: bankImports.fileSha256, accountId: bankImports.bankAccountId })
    .from(bankImports);

  const out: {
    file: string; importId: string; how: string; accountId: string | null;
    months: ReturnType<typeof monthBalancesFromStatement>; unreadMonths: string[];
  }[] = [];
  const unmatched: string[] = [];

  for (const file of statementPaths) {
    const buffer = readFileSync(file);
    const sha = fileFingerprint(buffer);
    const parsed = await readStatementFile(buffer, basename(file));

    let target = imports.find((i) => i.sha === sha);
    let how = "بصمة الملفّ";
    if (!target) {
      const byName = imports.find((i) => i.fileName === basename(file));
      if (byName && parsed.rows.length > 0) {
        const [{ found }] = (await db.execute<{ found: number }>(sql`
          select count(*)::int found from jsonb_to_recordset(${JSON.stringify(parsed.rows.map((r) => ({
            d: r.valueDate.toISOString().slice(0, 10), a: r.amountMinor, dir: r.direction,
          })))}::jsonb) as x(d text, a int, dir text)
          where exists (select 1 from bank_transactions t where t.bank_import_id = ${byName.id}
                         and (t.value_date at time zone 'UTC')::date = x.d::date
                         and t.amount_minor = x.a and t.direction::text = x.dir)
        `)).rows;
        const share = Number(found) / parsed.rows.length;
        if (share >= NAME_MATCH_MIN_SHARE) {
          target = byName;
          how = `الاسم، و${Math.round(share * 100)}٪ من صفوفه في حركاته`;
        }
      }
    }
    if (!target) { unmatched.push(basename(file)); continue; }

    const months = monthBalancesFromStatement(parsed.rows);
    const allMonths = [...new Set(parsed.rows.map((r) => r.valueDate.toISOString().slice(0, 7)))].sort();
    out.push({
      file: basename(file), importId: target.id, how, accountId: target.accountId, months,
      unreadMonths: allMonths.filter((m) => !months.some((x) => x.month === m)),
    });
  }
  return { out, unmatched };
}

async function textSources() {
  const docs = await db
    .select({ id: documents.id, mimeType: documents.mimeType, driveFileId: documents.driveFileId })
    .from(documents)
    .where(isNull(documents.textSource));

  const plan: { id: string; source: TextSource }[] = [];
  const counts = { images: 0, needsDownload: 0, noDriveFile: 0, unreadable: 0, downloadFailed: 0 };
  const drive = useDrive ? await driveForCli() : null;

  for (const d of docs) {
    let data: Buffer = Buffer.alloc(0);
    if (d.mimeType === PDF_TYPE) {
      if (!d.driveFileId) { counts.noDriveFile++; continue; }
      if (!drive) { counts.needsDownload++; continue; }
      try {
        data = (await downloadFile(drive, d.driveFileId)).data;
      } catch {
        counts.downloadFailed++;
        continue;
      }
    }
    const input = await resolveDocumentInput(data, d.mimeType);
    if (input.mode === "UNREADABLE") { counts.unreadable++; continue; }
    const source: TextSource = input.mode === "TEXT" ? "TEXT" : input.source;
    if (source === "DIRECT") counts.images++;
    plan.push({ id: d.id, source });
  }
  return { total: docs.length, plan, counts };
}

async function main() {
  if (apply) assertWriteAllowed("db:backfill-layers --apply");

  const accounts = await importAccounts();
  console.log(`\n١. حساب الاستيراد — ${accounts.plan.length} يُكتب · ${accounts.ambiguous.length} بلا حسابٍ واحد في حركاته`);
  for (const p of accounts.plan) console.log(`   ${p.fileName} ← ${p.accountId}`);

  const periods = await statementPeriods();
  const periodRows = periods.out.flatMap((s) => {
    const accountId = s.accountId ?? accounts.plan.find((p) => p.id === s.importId)?.accountId ?? null;
    return accountId ? s.months.map((m) => ({ ...m, accountId, file: s.file })) : [];
  });
  console.log(`\n٢. فترات التسوية — ${statementPaths.length} كشفاً مُمرَّراً · ${periodRows.length} شهراً تستقيم سلسلته`);
  for (const s of periods.out) {
    console.log(`   ${s.file} (نُسب بـ${s.how}): ${s.months.map((m) => m.month).join("، ") || "لا شهر"}` +
      (s.unreadMonths.length ? ` · مجهول: ${s.unreadMonths.join("، ")}` : ""));
  }
  if (periods.unmatched.length) console.log(`   لم يُنسَب إلى استيراد: ${periods.unmatched.join("، ")}`);

  const texts = await textSources();
  const bySource = texts.plan.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }), {});
  console.log(`\n٣. مصدر القراءة — ${texts.total} مستنداً بلا مصدر · يُكتب ${texts.plan.length} ${JSON.stringify(bySource)}`);
  console.log(`   يبقى مجهولاً: يحتاج تنزيلاً ${texts.counts.needsDownload} · بلا ملفّ درايف ${texts.counts.noDriveFile} · لا يُقرأ ${texts.counts.unreadable} · تعذّر تنزيله ${texts.counts.downloadFailed}`);

  if (!apply) {
    console.log("\n(معاينة — لم يُكتب شيء. للكتابة: --apply --i-know-this-is-production)\n");
    process.exit(0);
  }

  await db.transaction(async (t) => {
    for (const p of accounts.plan) {
      await t.update(bankImports).set({ bankAccountId: p.accountId })
        .where(and(eq(bankImports.id, p.id), isNull(bankImports.bankAccountId)));
    }
    for (const m of periodRows) {
      /* كما يكتبها الاستيراد: لا يُكتَب فوق فترةٍ راجعها إنسان، ولا فوق كشفٍ أطول */
      await t.insert(reconciliationPeriods).values({
        bankAccountId: m.accountId, periodStart: m.periodStart, periodEnd: m.periodEnd,
        openingBalanceMinor: m.openingMinor, closingBalanceMinor: m.closingMinor, importedCount: m.rows,
      }).onConflictDoUpdate({
        target: [reconciliationPeriods.bankAccountId, reconciliationPeriods.periodStart, reconciliationPeriods.periodEnd],
        set: { openingBalanceMinor: m.openingMinor, closingBalanceMinor: m.closingMinor, importedCount: m.rows },
        setWhere: sql`reconciliation_periods.reviewed_by_id is null and reconciliation_periods.imported_count <= ${m.rows}`,
      });
    }
    for (const p of texts.plan) {
      await t.update(documents).set({ textSource: p.source })
        .where(and(eq(documents.id, p.id), isNull(documents.textSource)));
    }
  });
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from reconciliation_periods`)).rows;
  console.log(`\n✓ كُتب. reconciliation_periods الآن ${n} صفّاً.\n`);
  process.exit(0);
}

main().catch((e) => { console.error("✕", (e as Error).message); process.exit(1); });

