/**
 * الكشوفُ مقابلَ الدفتر — إعادةُ مطابقة كلّ كشفٍ بقواعده الحاليّة، وقيدُ ما يذكره ولا ملفَّ له.
 *
 *   npx tsx --env-file=.env scripts/repair-statements.ts                 معاينة لا تكتب
 *   npx tsx --env-file=.env scripts/repair-statements.ts --i-know-this-is-production
 *
 * بإذن أحمد (٣ أكتوبر ٢٠٢٦). لكلّ كشفٍ له أسطر:
 *   ١. الأسطرُ المحفوظة بقيمتها المطلقة (الإيداعُ قُرئ سالباً في غاناش)، والرصيدُ الجاري
 *      المقروء مديناً يُعاد إلى موضعه (`repairRunningBalance`).
 *   ٢. كشفُ غاناش لأغسطس يُقرأ ثانيةً: حسابُه لا يستقيم (ينقص ٦٤٨٫٦٠ من أسطره).
 *   ٣. يُطابَق (`reconcileAndPersist`) — فاتورةٌ لسطرٍ واحد، والرقمُ المختلف ليس مطابقة
 *      حين ثبت أنّ المراجع أرقامُنا — ويُكتب ما بين كشفه ودفترنا إن افترقا.
 *   ٤. ما يذكره ولا ملفَّ له يُقيَّد منه (`recordStatementOnlyInvoices`) بضماناته.
 * والأشهرُ المقفلة تُفتح ثمّ تُقفل بشهادتها. وفي الآخر: كلُّ مورّدٍ مقابلَ آخر كشفه.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, monthCloses, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { companyConfig } from "@/config/drive";
import { driveForCli, downloadFile } from "@/lib/drive";
import { extractDocument } from "@/lib/extraction";
import { parseStatementExtras, repairRunningBalance } from "@/lib/extraction/statement-extras";
import type { RawStatementLine } from "@/services/invoice.service";
import { reconcileAndPersist } from "@/services/statement-reconcile.service";
import { recordStatementOnlyInvoices, StatementInvoicesRefused } from "@/services/statement-invoices.service";
import { learnSupplierVat } from "@/services/supplier-vat.service";
import { deriveSlug } from "@/services/supplier.service";
import { renameArchived } from "@/services/drive-rename.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const WHY = "الكشوفُ مقابلَ الدفتر — بإذن أحمد (٣ أكتوبر ٢٠٢٦)، نفّذه Claude";
const MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08"];
const REREAD = /Ganache_Statement_August/;
const riyal = (m: number) => (m / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });

async function main() {
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");
  const closed = await db.select().from(monthCloses).where(and(inArray(monthCloses.month, MONTHS), eq(monthCloses.status, "CLOSED")));
  if (WRITE) {
    for (const c of closed) {
      await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
      await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month, before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
    }
  }
  try {
    /* رقمُ المورّد الضريبيّ من فواتيره — لمن ليس في سجلّه */
    const ids = (await db.execute<{ id: string }>(sql`select id from suppliers where vat_number is null`)).rows;
    const learned: string[] = [];
    if (WRITE) for (const s of ids) { const v = await db.transaction((t) => learnSupplierVat(t, s.id)); if (v) learned.push(v); }
    console.log(`أرقامٌ ضريبيّة تُعُلّمت لمورّدين: ${WRITE ? learned.length : `(معاينة) ${ids.length} بلا رقم`}`);

    /* المورّدُ برمزٍ آليّ («SUPSL2F0X») يُسمّى من الاسم الإنجليزيّ في فاتورته، أو بالحروف اللاتينيّة */
    const coded = (await db.execute<{ id: string; name_ar: string; slug: string; en: string | null }>(sql`
      select s.id, s.name_ar, s.slug, (select d.extraction_json->>'supplierNameEn' from documents d where d.supplier_id = s.id and coalesce(d.extraction_json->>'supplierNameEn','') <> '' limit 1) en
        from suppliers s where s.slug ~ '^SUP[A-Z0-9]{5,6}$'`)).rows;
    for (const c of coded) {
      let slug = deriveSlug(c.en ?? undefined, c.name_ar);
      const [taken] = (await db.execute<{ id: string }>(sql`select id from suppliers where slug = ${slug} and id <> ${c.id}`)).rows;
      if (taken) slug = `${slug}2`;
      console.log(`اسمُ المورّد في الأرشيف: ${c.name_ar} ${c.slug} ← ${slug}`);
      if (WRITE) {
        await db.update(suppliers).set({ slug }).where(eq(suppliers.id, c.id));
        await recordAudit({ actorId: AHMED, action: "SUPPLIER_UPDATED", entityType: "supplier", entityId: c.id, before: { الاسم_في_الأرشيف: c.slug }, after: { الاسم_في_الأرشيف: slug, السبب: WHY } });
      }
    }

    const drive = await driveForCli(async () =>
      (await db.select({ t: accounts.refresh_token }).from(accounts).where(eq(accounts.provider, "google")).limit(1))[0]?.t ?? null);
    const sts = (await db.execute<{ id: string; document_id: string; supplier_id: string; name_ar: string; file_name: string; drive_file_id: string | null; ob: number | null; cb: number | null }>(sql`
      select st.id, st.document_id, st.supplier_id, s.name_ar, d.file_name, d.drive_file_id, st.opening_balance_minor ob, st.closing_balance_minor cb
        from statements st join documents d on d.id = st.document_id join suppliers s on s.id = st.supplier_id order by st.period_end`)).rows;

    for (const st of sts) {
      const stored = (await db.execute<{ date: string; ref: string | null; description: string | null; debit_minor: number; credit_minor: number }>(sql`
        select date::text, ref, description, debit_minor, credit_minor from statement_lines where statement_id = ${st.id} order by date, id`)).rows;
      if (stored.length === 0) continue;
      let lines: RawStatementLine[] = stored.map((l) => ({ date: new Date(l.date), ref: l.ref, description: l.description, debitMinor: Math.abs(l.debit_minor), creditMinor: Math.abs(l.credit_minor) }));
      let ob = st.ob;
      let cb = st.cb;
      lines = repairRunningBalance(lines, ob, cb) ?? lines;

      if (REREAD.test(st.file_name) && st.drive_file_id) {
        const file = await downloadFile(drive, st.drive_file_id);
        const x = await extractDocument({ data: file.data, mimeType: file.mimeType, companyVat: companyConfig.vatNumber, companyName: companyConfig.nameAr, supplierNames: [st.name_ar] });
        if (x.ok) {
          const extras = parseStatementExtras(x.value);
          const billed = (ls: RawStatementLine[]) => ls.reduce((s, l) => s + l.debitMinor, 0);
          console.log(`  قراءةٌ جديدة لـ${st.file_name}: ${extras.lines.length} سطراً، مدينُها ${riyal(billed(extras.lines))} (كان ${riyal(billed(lines))})`);
          if (extras.lines.length > 0 && billed(extras.lines) >= billed(lines)) {
            lines = extras.lines;
            ob = extras.openingBalanceMinor ?? ob;
            cb = extras.closingBalanceMinor ?? cb;
          }
        } else console.log(`  تعذّرت القراءة: ${x.reason}`);
      }

      const r = await reconcileAndPersist({ statementId: st.id, supplierId: st.supplier_id, supplierName: st.name_ar, documentId: st.document_id,
        lines, openingMinor: ob, closingMinor: cb, actorId: AHMED, persist: WRITE, note: WHY });
      let recorded = "";
      if (WRITE) {
        try {
          const out = await db.transaction((t) => recordStatementOnlyInvoices(t, st.id, AHMED));
          if (out.created.length) recorded = ` → قُيِّد من الكشف ${out.created.length} (${riyal(out.created.reduce((s, c) => s + c.amountMinor, 0))})`;
          if (out.closedMonth.length) recorded += ` · في شهرٍ مقفل ${out.closedMonth.length}`;
        } catch (e) {
          if (e instanceof StatementInvoicesRefused) recorded = " → لا يُقيَّد منه (مراجعُه ليست أرقامنا)";
          else throw e;
        }
      }
      console.log(`${st.name_ar} · ${st.file_name}: طوبق ${r.result.matchedCount}/${lines.length} · فروق ${r.result.amountMismatches.length} · بلا ملفّ ${r.result.missingFromArchive.length}${recorded}`);
    }

    /* ما سُمّي اسمُه مورّدُه برمز أو فيه «/» — يُسمّى من القيد */
    if (WRITE && process.env.DRIVE_ALLOW_WRITE === "true") {
      for (let round = 0; round < 5; round++) {
        const out = await renameArchived(drive, null, AHMED, `إصلاح ٣ أكتوبر — ${WHY}`);
        if (out.done.length) console.log(`سُمّي ${out.done.length}: ${out.done.map((x) => `${x.from} ← ${x.to}`).join(" | ")}`);
        if (out.failed.length) console.log(`فشل: ${out.failed.map((f) => `${f.from}: ${f.error}`).join(" | ")}`);
        if (out.done.length === 0) break;
      }
    }

    const bal = (await db.execute<{ name_ar: string; pe: string; theirs: number; ours: number }>(sql`
      with latest as (select distinct on (st.supplier_id) st.supplier_id, st.period_end::date pe, st.closing_balance_minor cb
                        from statements st join statement_lines sl on sl.statement_id = st.id
                       where st.closing_balance_minor is not null order by st.supplier_id, st.period_end desc)
      select s.name_ar, l.pe::text, l.cb::bigint theirs,
        ((select coalesce(sum(i.total_minor),0) from invoices i join documents dd on dd.id=i.document_id where i.supplier_id=l.supplier_id and i.invoice_date::date <= l.pe and dd.status <> 'REJECTED')
         - (select coalesce(sum(p.amount_minor - p.fee_minor),0) from payments p where p.supplier_id=l.supplier_id and p.paid_at::date < l.pe and p.status not in ('VOID','REVERSED')))::bigint ours
        from latest l join suppliers s on s.id = l.supplier_id order by 1`)).rows;
    console.log("\nكلُّ مورّدٍ مقابلَ آخر كشفه:");
    for (const b of bal) {
      const gap = Number(b.ours) - Number(b.theirs);
      console.log(`  ${Math.abs(gap) <= 100 ? "✓" : "✕"} ${b.name_ar} (${b.pe}): كشفُه ${riyal(Number(b.theirs))} · دفترُنا ${riyal(Number(b.ours))}${Math.abs(gap) > 100 ? ` · الفرق ${riyal(gap)}` : ""}`);
    }
  } finally {
    if (WRITE) {
      for (const c of closed) {
        const checklist = { ...(c.checklist as Record<string, unknown>), أُعيد_إقفاله: WHY };
        await db.update(monthCloses).set({ status: "CLOSED", checklist: checklist as never, closedById: AHMED, closedAt: new Date() }).where(eq(monthCloses.id, c.id));
        await recordAudit({ actorId: AHMED, action: "MONTH_CLOSED", entityType: "month_close", entityId: c.month, after: { السبب: WHY } });
      }
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
