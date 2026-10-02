/**
 * إصلاحُ ٣ أكتوبر ٢٠٢٦ — بإذن أحمد الصريح («أعطيك كامل الصلاحية… اعملها بنفسك»).
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-03.ts                 معاينة لا تكتب
 *   DRIVE_ALLOW_WRITE=true npx tsx --env-file=.env scripts/repair-2026-10-03.ts --i-know-this-is-production
 *
 * كلُّ خطوةٍ بخدمات النظام نفسها، وبأثرٍ في سجلّ التدقيق باسم أحمد وسببِها، وتُعيد
 * النتيجة نفسها إن شُغّلت مرّتين (ما تمّ يُتخطّى):
 *
 *   ١. يُعاد فتح يونيو ويوليو وأغسطس، وتُعاد إقفالُها بشهادتها السابقة في الآخر.
 *   ٢. الحالُ الضريبيّة القديمة تُعاد على حقول الفاتورة.
 *   ٣. أسماءُ المصروفات البنكيّة من حركاتها (راتبُ صالح كيكي ليس «لوريفا كيك»).
 *   ٤. لوريفا: SI-0034 مرفوضةٌ خطأً تُعاد وتُقيَّد؛ وسدادُ ٢٩ سبتمبر اليدويّ لـSI-0037/0041
 *      يُلغى (VOID — الحوالةُ نفسُها سدّدتهما)؛ وحوالةُ ٢ سبتمبر تُوزَّع بالأقدم أوّلاً.
 *   ٥. مختبرات القهوة V405791: مؤرشفةٌ بلا قيد — تُقيَّد من قراءتها.
 *   ٦. الكشوف: ما قُرئ رصيدُه الجاري مديناً يُصلَح ويُطابَق، وكشفا أوراق الزيتون ليونيو
 *      ويوليو يُقرآن ثانيةً.
 *   ٧. إعادةُ قراءة: رونة ٤١٣٦ (رسوم التوصيل) وصورُ HEIC التي لم تُقرأ.
 *   ٨. التسمية: الاسمُ من الدرايف، ثمّ ما يخالف المقيَّد يُسمّى.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, monthCloses, paymentAllocations, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { driveForCli, downloadFile } from "@/lib/drive";
import { evaluateInvoice } from "@/lib/invoice-findings";
import { companyConfig } from "@/config/drive";
import { extractDocument } from "@/lib/extraction";
import { parseStatementExtras, repairRunningBalance } from "@/lib/extraction/statement-extras";
import { correctInvoice } from "@/services/invoice-correction.service";
import { resyncBankExpenses } from "@/services/expense.service";
import { refreshPaymentStatus, reversePayment } from "@/services/payment.service";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { recordDocumentByHand } from "@/services/document-record.service";
import { reconcileAndPersist } from "@/services/statement-reconcile.service";
import { rereadDocument } from "@/services/document-reread.service";
import { renameArchived } from "@/services/drive-rename.service";
import type { StoredReading } from "@/services/document-backlog.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const WHY = "إصلاحٌ بإذن أحمد (٣ أكتوبر ٢٠٢٦) — نفّذه Claude";
const MONTHS = ["2026-06", "2026-07", "2026-08"];
const LORIVA = "29e08df3-8619-44a9-be9d-2a2977a31cbd";
const LORIVA_TRANSFER = "4835193a-9a61-48bb-a94b-c9ff722a0aee";
const LORIVA_HAND = ["2acf9b1a-1f2d-403c-b375-7885cbdb3b26", "adb77810-8047-464d-bc5d-d1952bd4edd3"];

const say = (s: string) => console.log(`${WRITE ? "✓" : "·"} ${s}`);

async function drive() {
  return driveForCli(async () =>
    (await db.select({ t: accounts.refresh_token }).from(accounts).where(eq(accounts.provider, "google")).limit(1))[0]?.t ?? null);
}

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.log(`✕ ${name}: ${(e as Error).message}`);
  }
}

async function main() {
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");

  /* ── ١. فتح الأشهر ── */
  const closed = await db.select().from(monthCloses).where(and(inArray(monthCloses.month, MONTHS), eq(monthCloses.status, "CLOSED")));
  say(`أشهرٌ مقفلة تُفتح: ${closed.map((c) => c.month).join("، ") || "لا شيء"}`);
  if (WRITE) {
    for (const c of closed) {
      await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
      await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month,
        before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
    }
  }

  try {
    /* ── ٢. الحالُ الضريبيّة ── */
    await step("الحال الضريبيّة", async () => {
      const rows = (await db.execute<{ id: string; n: string; kind: string | null; seller_vat: string | null; buyer_vat: string | null;
        sub: number | null; vat: number | null; tot: number; disc: number | null; chg: number | null; tax: string; ii: boolean | null; co: boolean | null }>(sql`
        select i.id, i.invoice_number n, d.kind, i.seller_vat, i.buyer_vat, i.subtotal_minor sub, i.vat_minor vat, i.total_minor tot,
               i.discount_minor disc, i.charges_minor chg, i.tax_status tax, s.issues_invoices ii, s.contract_on_file co
          from invoices i join documents d on d.id = i.document_id left join suppliers s on s.id = i.supplier_id`)).rows;
      const stale = rows.filter((r) => evaluateInvoice(
        { kind: r.kind, invoiceNumber: r.n, sellerVat: r.seller_vat, buyerVat: r.buyer_vat, subtotalMinor: r.sub, vatMinor: r.vat, totalMinor: r.tot, discountMinor: r.disc, chargesMinor: r.chg },
        r.ii === null ? null : { issuesInvoices: r.ii, contractOnFile: r.co ?? false }, companyConfig.vatNumber,
      ).taxStatus !== r.tax);
      say(`حالٌ ضريبيّة قديمة: ${stale.map((r) => r.n).join("، ") || "لا شيء"}`);
      if (WRITE) for (const r of stale) await db.transaction((t) => correctInvoice(t, { invoiceId: r.id }, AHMED));
    });

    /* ── ٣. أسماءُ المصروفات ── */
    await step("المصروفات", async () => {
      if (!WRITE) return say("أسماءُ المصروفات البنكيّة تُعاد من حركاتها (يونيو–أغسطس)");
      for (const m of MONTHS) {
        const out = await db.transaction((t) => resyncBankExpenses(t, AHMED, { month: m }));
        say(`مصروفات ${m}: حُدّث ${out.updated}`);
      }
    });

    /* ── ٤. لوريفا ── */
    await step("لوريفا SI-0034", async () => {
      const [si34] = await db.select({ id: documents.id, status: documents.status, reading: documents.extractionJson })
        .from(documents).where(sql`${documents.fileName} like '%SI-0034%'`);
      const has34 = si34 ? (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.documentId, si34.id))).length > 0 : true;
      say(`SI-0034: ${si34?.status} — ${has34 ? "مقيَّدة" : "تُعاد وتُقيَّد"}`);
      if (!WRITE || !si34 || has34) return;
      if (si34.status === "REJECTED") {
        await db.transaction(async (t) => {
          await t.update(documents).set({ status: "NEEDS_REVIEW" }).where(eq(documents.id, si34.id));
          await recordAudit({ actorId: AHMED, action: "DOCUMENT_STATUS_CHANGED", entityType: "document", entityId: si34.id,
            before: { الحال: "مرفوض" }, after: { الحال: "ينتظر المراجعة", السبب: `رُفضت «مكرَّرة» خطأً: لا ملفَّ آخر بها، وحوالةُ ٢ سبتمبر (٤٬١٥١٫٥٠) هي أغسطس بها. ${WHY}` } }, t);
        });
      }
      const x = (si34.reading ?? {}) as StoredReading;
      const out = await recordDocumentByHand(AHMED, {
        documentId: si34.id, kind: "TAX_INVOICE", supplierId: LORIVA, invoiceNumber: x.invoiceNumber || "SI-0034",
        invoiceDate: x.invoiceDate || "2026-08-25", subtotal: x.subtotalAmount, vat: x.vatAmount, total: x.totalAmount || "253.00",
        sellerVat: x.sellerVatNumber, buyerVat: x.buyerVatNumber,
      }, false);
      say(`  قُيِّدت: ${out.invoiceId ? `نعم (${out.review.taxStatus})` : `لا — ${out.review.blockers.map((b) => b.message).join("؛ ")}`}`);
      if (out.invoiceId) {
        await db.transaction(async (t) => {
          await t.update(documents).set({ status: "ARCHIVED" }).where(eq(documents.id, si34.id));
          await recordAudit({ actorId: AHMED, action: "DOCUMENT_ARCHIVED", entityType: "document", entityId: si34.id, after: { السبب: WHY } }, t);
        });
      }
    });

    await step("لوريفا السداد", async () => {
      const hand = (await db.execute<{ id: string; status: string; amount_minor: number }>(sql`
        select id, status::text, amount_minor from payments where id in (${sql.join(LORIVA_HAND.map((i) => sql`${i}`), sql`, `)})`)).rows;
      say(`سدادٌ يدويّ لـSI-0037/0041 يُلغى: ${hand.filter((h) => h.status !== "VOID").map((h) => (h.amount_minor / 100).toFixed(2)).join(" و") || "أُلغي من قبل"}`);
      if (!WRITE) return;
      for (const h of hand.filter((x) => x.status !== "VOID")) {
        await db.transaction(async (t) => {
          const out = await reversePayment(t, { paymentId: h.id, kind: "VOID", userId: AHMED,
            reason: "سُجّل سداداً بيد في ٢٩ سبتمبر، والفاتورةُ مسدَّدةٌ بحوالة ٢ سبتمبر (٤٬١٥١٫٥٠ = فواتير أغسطس كلّها)" });
          await recordAudit({ actorId: AHMED, action: "PAYMENT_VOIDED", entityType: "payment", entityId: h.id,
            before: { التخصيص: out.previousAllocations }, after: { الحال: out.status, السبب: `${out.reason} — ${WHY}` } }, t);
        });
      }
      await db.transaction(async (t) => {
        const before = await t.select({ invoiceId: paymentAllocations.invoiceId, amountMinor: paymentAllocations.amountMinor })
          .from(paymentAllocations).where(eq(paymentAllocations.paymentId, LORIVA_TRANSFER));
        await t.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, LORIVA_TRANSFER));
        await refreshPaymentStatus(t, LORIVA_TRANSFER);
        const out = await applySupplierCredit(t, LORIVA, { forwardDays: null, paymentIds: [LORIVA_TRANSFER] });
        await recordAudit({ actorId: AHMED, action: "PAYMENT_REALLOCATED", entityType: "payment", entityId: LORIVA_TRANSFER,
          before: { التخصيص: before }, after: { التخصيص: out.allocations, السبب: `حوالةُ ٢ سبتمبر بالأقدم أوّلاً — فواتيرُ أغسطس وصل ثلاثٌ منها متأخّرة. ${WHY}` } }, t);
        say(`  حوالةُ ٢ سبتمبر وُزّعت على ${out.allocations.length} فواتير (${(out.appliedMinor / 100).toFixed(2)})`);
      });
    });

    /* ── ٤ب. لافا كمبوتشا: دفعةٌ وهميّة نسخةُ حوالة ٧ أغسطس ── */
    await step("لافا", async () => {
      const PHANTOM = "15bd5c9f-eb81-4dc9-b4bb-72113b6e4db5";
      const [p] = (await db.execute<{ status: string; supplier_id: string; bank: boolean }>(sql`
        select status::text, supplier_id, exists(select 1 from bank_transactions bt where bt.matched_payment_id = ${PHANTOM}) bank from payments where id = ${PHANTOM}`)).rows;
      say(`لافا ٩٤٥ (٧ أغسطس) بلا حركة بنك: ${!p ? "غير موجودة" : p.status === "VOID" ? "أُلغيت من قبل" : p.bank ? "لها حركة — لا تُمسّ" : "تُلغى"}`);
      if (!WRITE || !p || p.status === "VOID" || p.bank) return;
      await db.transaction(async (t) => {
        const out = await reversePayment(t, { paymentId: PHANTOM, kind: "VOID", userId: AHMED,
          reason: "نسخةٌ من حوالة ٧ أغسطس (٩٤٥): اليومُ والمبلغُ ونصُّ البنك واحد، والحوالةُ مطابَقةٌ بدفعةٍ أخرى، ولا حركة بنكٍ لهذه" });
        await recordAudit({ actorId: AHMED, action: "PAYMENT_VOIDED", entityType: "payment", entityId: PHANTOM,
          before: { التخصيص: out.previousAllocations }, after: { الحال: out.status, السبب: `${out.reason} — ${WHY}` } }, t);
        const credit = await applySupplierCredit(t, p.supplier_id, { forwardDays: null });
        say(`  وزّعت حوالاتُ لافا الحقيقيّة ${(credit.appliedMinor / 100).toFixed(2)} على ${credit.allocations.length} فواتير`);
      });
    });

    /* ── ٥. مختبرات القهوة V405791 ── */
    await step("V405791", async () => {
      const [v791] = await db.select({ id: documents.id, reading: documents.extractionJson, supplierId: documents.supplierId })
        .from(documents).where(sql`${documents.fileName} like '%V405791%'`);
      const has791 = v791 ? (await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.documentId, v791.id))).length > 0 : true;
      const [coffeeLabs] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.nameAr, "مختبرات القهوة"));
      say(`V405791: ${has791 ? "مقيَّدة" : "تُقيَّد من قراءتها"}`);
      if (!WRITE || !v791 || has791 || !coffeeLabs) return;
      const x = (v791.reading ?? {}) as StoredReading;
      const out = await recordDocumentByHand(AHMED, {
        documentId: v791.id, kind: "TAX_INVOICE", supplierId: v791.supplierId ?? coffeeLabs.id,
        invoiceNumber: (x.invoiceNumber ?? "").replace(/^#/, "") || "V405791", invoiceDate: x.invoiceDate ?? "",
        subtotal: x.subtotalAmount, vat: x.vatAmount, total: x.totalAmount ?? "", sellerVat: x.sellerVatNumber, buyerVat: x.buyerVatNumber,
      }, false);
      say(`  قُيِّدت: ${out.invoiceId ? `نعم (${out.review.taxStatus})` : `لا — ${out.review.blockers.map((b) => b.message).join("؛ ") || "ناقصة"}`}`);
    });

    const d = await drive();

    /* ── ٦. الكشوف ── */
    await step("الكشوف", async () => {
      const sts = (await db.execute<{ id: string; document_id: string; supplier_id: string; name_ar: string; file_name: string; drive_file_id: string | null; ob: number | null; cb: number | null }>(sql`
        select st.id, st.document_id, st.supplier_id, s.name_ar, dd.file_name, dd.drive_file_id, st.opening_balance_minor ob, st.closing_balance_minor cb
          from statements st join documents dd on dd.id = st.document_id join suppliers s on s.id = st.supplier_id`)).rows;
      for (const st of sts) {
        const ls = (await db.execute<{ date: string; ref: string | null; description: string | null; debit_minor: number; credit_minor: number }>(sql`
          select date::text, ref, description, debit_minor, credit_minor from statement_lines where statement_id = ${st.id} order by date, id`)).rows;
        if (ls.length === 0) continue;
        const lines = ls.map((l) => ({ date: new Date(l.date), ref: l.ref, description: l.description, debitMinor: l.debit_minor, creditMinor: l.credit_minor }));
        const fixed = repairRunningBalance(lines, st.ob, st.cb);
        const reread = /OliveLeaves_Statement_(to-31-07|lists-all-June)/.test(st.file_name);
        if (!fixed && !reread) continue;
        say(`كشف ${st.file_name}: ${fixed ? "أعمدتُه تُصلَح وتُعاد مطابقتُه" : "يُقرأ ثانيةً"}`);
        if (!WRITE) continue;
        let use = fixed;
        let ob = st.ob;
        let cb = st.cb;
        if (!use && st.drive_file_id) {
          const file = await downloadFile(d, st.drive_file_id);
          const x = await extractDocument({ data: file.data, mimeType: file.mimeType, companyVat: companyConfig.vatNumber, companyName: companyConfig.nameAr, supplierNames: [st.name_ar] });
          if (!x.ok) { say(`  تعذّرت القراءة: ${x.reason}`); continue; }
          const extras = parseStatementExtras(x.value);
          if (extras.lines.length === 0) { say("  لم تُقرأ أسطر — بقي كما كان"); continue; }
          use = extras.lines;
          ob = extras.openingBalanceMinor;
          cb = extras.closingBalanceMinor;
        }
        if (!use) continue;
        const out = await reconcileAndPersist({ statementId: st.id, supplierId: st.supplier_id, supplierName: st.name_ar, documentId: st.document_id,
          lines: use, openingMinor: ob, closingMinor: cb, actorId: AHMED, persist: true, note: WHY });
        say(`  طوبقت ${out.result.matchedCount} من ${use.length} · فروق ${out.result.amountMismatches.length} · ناقصة ${out.result.missingFromArchive.length}`);
      }
    });

    /* ── ٧. إعادةُ القراءة ── */
    await step("إعادة القراءة", async () => {
      const rereads = (await db.execute<{ id: string; file_name: string }>(sql`
        select d.id, d.file_name from documents d where d.file_name like '%Rawnah_Invoice_4136%' or (d.file_name ~* '\\.hei[cf]$' and d.extraction_json is null)
           or exists (select 1 from invoices i where i.document_id = d.id and (i.subtotal_minor is null or i.vat_minor is null) and i.period_month >= '2026-06')`)).rows;
      for (const r of rereads) {
        say(`إعادة قراءة ${r.file_name}`);
        if (!WRITE) continue;
        const out = await rereadDocument({ documentId: r.id, actorId: AHMED, drive: d, apply: true });
        say(`  ${out.ok ? (out.applied ? `كُتبت: ${out.amountsWritten ? "المبالغ" : "بلا مبالغ"} · ${out.linesWritten} بنود · ${out.taxStatus}${out.problem ? ` · ${out.problem}` : ""}` : "لم تُكتب") : out.error}`);
      }
    });

    /* ── ٨. التسمية ── */
    await step("التسمية", async () => {
      const live = new Map<string, string>();
      const known = await db.select({ id: documents.driveFileId, name: documents.fileName }).from(documents).where(eq(documents.status, "ARCHIVED"));
      for (const k of known) {
        if (!k.id) continue;
        try {
          const meta = await d.files.get({ fileId: k.id, fields: "name", supportsAllDrives: true });
          if (meta.data.name && meta.data.name !== k.name) live.set(k.id, meta.data.name);
        } catch { /* ملفٌّ لم يعد يُرى — لا يُمسّ */ }
      }
      say(`أسماءٌ تغيّرت في الدرايف ولم تتغيّر عندنا: ${[...live.values()].join("، ") || "لا شيء"}`);
      if (!WRITE) return;
      for (const [id, name] of live) await db.update(documents).set({ fileName: name }).where(eq(documents.driveFileId, id));
      if (process.env.DRIVE_ALLOW_WRITE !== "true") return say("التسمية تحتاج DRIVE_ALLOW_WRITE=true");
      for (let round = 0; round < 5; round++) {
        const out = await renameArchived(d, null, AHMED, `إصلاح ٣ أكتوبر — ${WHY}`);
        if (out.done.length) say(`سُمّي ${out.done.length}: ${out.done.map((x) => `${x.from} ← ${x.to}`).join(" | ")}`);
        if (out.failed.length) say(`فشل: ${out.failed.map((f) => `${f.from}: ${f.error}`).join(" | ")}`);
        if (out.done.length === 0) break;
      }
    });
  } finally {
    /* ── ٩. إعادة الإقفال بشهادته السابقة ── */
    if (WRITE) {
      for (const c of closed) {
        const checklist = { ...(c.checklist as Record<string, unknown>), أُعيد_إقفاله: WHY };
        await db.update(monthCloses).set({ status: "CLOSED", checklist: checklist as never, closedById: AHMED, closedAt: new Date() })
          .where(eq(monthCloses.id, c.id));
        await recordAudit({ actorId: AHMED, action: "MONTH_CLOSED", entityType: "month_close", entityId: c.month, after: { السبب: WHY } });
      }
      say(`أُعيد إقفال: ${closed.map((c) => c.month).join("، ")}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
