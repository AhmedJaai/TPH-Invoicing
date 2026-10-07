/**
 * رقمٌ قُرئ مقلوباً، وكشفان قُيِّدا قبل أن يُطابَق الكشفُ حين يُقيَّد.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-03c.ts                 معاينة لا تكتب
 *   npx tsx --env-file=.env scripts/repair-2026-10-03c.ts --i-know-this-is-production
 *
 * بإذن أحمد (٣ أكتوبر ٢٠٢٦):
 *   ١. فاتورةُ لوريفا «0059-SI» هي «SI-0059» (السطرُ اليمينيّ قدّم الأرقام) — يُصحَّح رقمُها،
 *      ويُسمّى ملفُّها في الدرايف إن `DRIVE_ALLOW_WRITE=true`.
 *   ٢. كلُّ كشفٍ أسطرُه كلُّها «غير مطابَقة» (رُفع قبل أن يُطابَق حين يُقيَّد) يُطابَق من أسطره
 *      المحفوظة، ثمّ تُعاد تنبيهاتُه.
 * ويُعطي النتيجةَ نفسها إن شُغِّل مرّتين.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, statementLines, statements, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { driveForCli } from "@/lib/drive";
import { unreverseInvoiceNumber } from "@/lib/invoice-number";
import { applyRenames } from "@/services/drive-rename.service";
import { reconcileAndPersist, refreshStatementFindings } from "@/services/statement-reconcile.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const WHY = "رقمٌ قُرئ مقلوباً / كشفٌ لم يُطابَق حين قُيِّد — بإذن أحمد (٣ أكتوبر ٢٠٢٦)";

async function main() {
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");

  const reversed = (await db.execute<{ id: string; n: string; doc: string; file: string; drive: string | null }>(sql`
    select i.id, i.invoice_number n, d.id doc, d.file_name file, d.drive_file_id drive
      from invoices i join documents d on d.id = i.document_id
     where i.invoice_number ~ '^[0-9]+[-/_ ][A-Za-z]+$'`)).rows;
  for (const r of reversed) {
    const fixed = unreverseInvoiceNumber(r.n);
    const name = r.file.replace(r.n, fixed);
    console.log(`رقمٌ مقلوب: ${r.n} ← ${fixed} · ${r.file}${name !== r.file ? ` ← ${name}` : ""}`);
    if (!WRITE) continue;
    await db.transaction(async (t) => {
      await t.update(invoices).set({ invoiceNumber: fixed }).where(eq(invoices.id, r.id));
      await recordAudit({ actorId: AHMED, action: "INVOICE_FIELDS_CORRECTED", entityType: "invoice", entityId: r.id,
        before: { الرقم: r.n }, after: { الرقم: fixed, السبب: WHY } }, t);
    });
    if (process.env.DRIVE_ALLOW_WRITE === "true" && r.drive && name !== r.file) {
      const drive = await driveForCli(async () =>
        (await db.select({ t: accounts.refresh_token }).from(accounts).where(eq(accounts.provider, "google")).limit(1))[0]?.t ?? null);
      const out = await applyRenames(drive, [{ driveFileId: r.drive, fileName: r.file, proposed: name }], { actorId: AHMED, via: "نصُّ إصلاح" });
      if (out.done.length) {
        await recordAudit({ actorId: AHMED, action: "DRIVE_FILE_RENAMED", entityType: "drive", entityId: "rename",
          after: { الفعل: "إعادة تسمية", المصدر: WHY, الملفّات: out.done.map((d) => `${d.from} ← ${d.to}`) } });
      }
      console.log(out.done.length ? `  سُمّي: ${name}` : `  فشلت التسمية: ${out.failed.map((f) => f.error).join(" | ")}`);
    }
  }

  const unmatched = (await db.execute<{ id: string }>(sql`
    select st.id from statements st
     where exists (select 1 from statement_lines sl where sl.statement_id = st.id)
       and not exists (select 1 from statement_lines sl where sl.statement_id = st.id and sl.match_status <> 'UNMATCHED')`)).rows;
  for (const { id } of unmatched) {
    const [st] = await db.select({ supplierId: statements.supplierId, documentId: statements.documentId, ob: statements.openingBalanceMinor, cb: statements.closingBalanceMinor, name: suppliers.nameAr, file: documents.fileName })
      .from(statements).innerJoin(suppliers, eq(suppliers.id, statements.supplierId)).innerJoin(documents, eq(documents.id, statements.documentId))
      .where(eq(statements.id, id));
    const lines = await db.select({ date: statementLines.date, ref: statementLines.ref, description: statementLines.description, debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor })
      .from(statementLines).where(and(eq(statementLines.statementId, id))).orderBy(statementLines.date, statementLines.id);
    const r = await reconcileAndPersist({ statementId: id, supplierId: st.supplierId, supplierName: st.name, documentId: st.documentId,
      lines, openingMinor: st.ob, closingMinor: st.cb, actorId: AHMED, persist: WRITE, note: WHY });
    if (WRITE) await db.transaction((t) => refreshStatementFindings(t, id));
    console.log(`${st.name} · ${st.file}: طوبق ${r.result.matchedCount}/${lines.length} · فروق ${r.result.amountMismatches.length} · ليست عندنا ${r.result.missingFromArchive.length}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
