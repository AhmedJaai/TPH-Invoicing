/**
 * إجاباتُ أحمد (٣ أكتوبر ٢٠٢٦) على ما بقي من مراجعة الكشوف — وتنبيهاتُ الكشوف بعد القيد.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-03b.ts                 معاينة لا تكتب
 *   npx tsx --env-file=.env scripts/repair-2026-10-03b.ts --i-know-this-is-production
 *
 *   ١. «الكوب الذهبي عرض سعر وليست فاتورة»: ملفُّ «2026-07-15_GoldenCup_Statement» عرضُ سعرٍ
 *      للفاتورة INV264916 قُيِّد كشفاً. يصير `PROFORMA`، ويُحذف كشفُه (أسطرُه تتبعه) وتُحسم
 *      تنبيهاتُه، ويُسمّى في الدرايف كأخويه («…_ProformaInvoice_…») إن `DRIVE_ALLOW_WRITE=true`.
 *   ٢. «فودكس لا توجد فاتورة»: سدادُ ١٧ سبتمبر (١٬١٢١٫٨٢، GoPay) ليس سداداً لفاتورة — قيدُه
 *      سداداً يُلغى (VOID بسببه)، وحركتُه تصير مصروفاً «أخرى» يُقيَّد من البنك. كان رصيداً
 *      «لنا عند فودكس» لن يأتي به شيء، و«اطلب الفاتورة» لما لا فاتورة له.
 *   ٣. كشفان لا يستقيم حسابُهما بقراءةٍ واحدة (`repairStatementArithmetic`): هنقري مان يونيو
 *      (دائنُ السداد قُرئ رصيدَه: ٨٠ وهو ٢٤٠) وأوراق الزيتون يونيو (الافتتاحيُّ أوّلُ فاتورة).
 *      يُعاد سطرُهما ويُطابَقان. وسدادُ هنقري مان لمايو مقيَّدٌ بتاريخ ١ مايو (يومُ «الشهر» لا
 *      يومُ السداد)، وكشفُه يقول وصل ٥ يونيو (FT26156PLPFN) — فيُكتب يومُه.
 *   ٤. تنبيهاتُ كلّ كشف تُعاد من القاعدة (`refreshStatementFindings`): «قيّدها من الكشف»
 *      كتب فواتيرَه بعد أن كُتبت تنبيهاتُه، فبقي «ينقصنا ٥٬٢٢٥٫٦٠» عن كشفٍ يطابق دفترنا.
 *      وما كُتب من فرق الدفتر برمز `STATEMENT_AMOUNT_MISMATCH` يُحسم ويُكتب برمزه.
 * ويُعطي النتيجةَ نفسها إن شُغِّل مرّتين.
 */
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, bankTransactions, decisionHistory, documents, issues, monthCloses, payments, statementLines, statements, suppliers } from "@/db/schema";
import { repairStatementArithmetic } from "@/lib/extraction/statement-extras";
import { reconcileAndPersist } from "@/services/statement-reconcile.service";
import { recordAudit } from "@/lib/audit";
import { CLASSIFICATION_VERSION } from "@/lib/bank/classification";
import { driveForCli } from "@/lib/drive";
import { applyRenames } from "@/services/drive-rename.service";
import { deriveOpenMonths } from "@/services/expense.service";
import { reversePayment } from "@/services/payment.service";
import { refreshStatementFindings } from "@/services/statement-reconcile.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const GOLDEN_CUP_DOC = "02e68047-8630-4946-bbb9-aa270b822092";
const GOLDEN_CUP_NAME = "2026-07-15_GoldenCup_ProformaInvoice_INV264916_SAR12003.13.pdf";
const FOODICS_PAYMENT = "b293e14b-a637-41cd-9f03-3b85e07ea281";
const WHY = "إجابةُ أحمد (٣ أكتوبر ٢٠٢٦)";
const HUNGRY_MAN_PAYMENT = "e6177344-20cb-4958-921c-96df261892d6";
const HUNGRY_MAN_PAID = new Date("2026-06-05T00:00:00Z");

async function main() {
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");

  /* ١. الكوب الذهبي */
  const [gc] = await db.select({ id: documents.id, kind: documents.kind, fileName: documents.fileName, driveFileId: documents.driveFileId })
    .from(documents).where(eq(documents.id, GOLDEN_CUP_DOC));
  if (gc && gc.kind === "STATEMENT") {
    const sts = await db.select({ id: statements.id }).from(statements).where(eq(statements.documentId, gc.id));
    console.log(`الكوب الذهبي: ${gc.fileName} — كشفٌ ← عرضُ سعر (يُحذف ${sts.length} كشف)`);
    if (WRITE) {
      await db.transaction(async (t) => {
        const ids = sts.map((s) => s.id);
        if (ids.length > 0) {
          await t.update(issues).set({ status: "RESOLVED", resolvedAt: new Date(), resolvedById: AHMED, waiverReason: `عرضُ سعرٍ لا كشف — ${WHY}` })
            .where(and(eq(issues.entityType, "statement"), inArray(issues.entityId, ids), eq(issues.status, "OPEN")));
          await t.delete(statements).where(inArray(statements.id, ids));
        }
        await t.update(documents).set({ kind: "PROFORMA" }).where(eq(documents.id, gc.id));
        await recordAudit({ actorId: AHMED, action: "DOCUMENT_STATUS_CHANGED", entityType: "document", entityId: gc.id,
          before: { النوع: "STATEMENT", كشوف: ids }, after: { النوع: "PROFORMA", السبب: `عرضُ سعرٍ للفاتورة INV264916 لا كشفُ حساب — ${WHY}` } }, t);
      });
    }
  } else console.log(`الكوب الذهبي: ${gc ? `نوعُه ${gc.kind} — لا شيء` : "لم يُوجد"}`);
  if (WRITE && process.env.DRIVE_ALLOW_WRITE === "true" && gc?.driveFileId) {
    const [now] = await db.select({ fileName: documents.fileName }).from(documents).where(eq(documents.id, gc.id));
    if (now && now.fileName !== GOLDEN_CUP_NAME) {
      const drive = await driveForCli(async () =>
        (await db.select({ t: accounts.refresh_token }).from(accounts).where(eq(accounts.provider, "google")).limit(1))[0]?.t ?? null);
      const out = await applyRenames(drive, [{ driveFileId: gc.driveFileId, fileName: now.fileName, proposed: GOLDEN_CUP_NAME }]);
      if (out.done.length) {
        await recordAudit({ actorId: AHMED, action: "DRIVE_FILE_RENAMED", entityType: "drive", entityId: "rename",
          after: { الفعل: "إعادة تسمية", المصدر: `عرضُ سعرٍ قُيِّد كشفاً — ${WHY}`, الملفّات: out.done.map((d) => `${d.from} ← ${d.to}`) } });
      }
      console.log(out.done.length ? `  سُمّي: ${GOLDEN_CUP_NAME}` : `  فشلت التسمية: ${out.failed.map((f) => f.error).join(" | ")}`);
    }
  }

  /* ٢. فودكس */
  const [fp] = await db.select().from(payments).where(eq(payments.id, FOODICS_PAYMENT));
  const [ft] = fp ? await db.select().from(bankTransactions).where(eq(bankTransactions.matchedPaymentId, fp.id)) : [];
  if (fp && fp.status !== "VOID" && fp.status !== "REVERSED") {
    console.log(`فودكس: سدادُ ${fp.paidAt.toISOString().slice(0, 10)} بـ${fp.amountMinor / 100} — يُلغى قيدُه سداداً وتصير حركتُه مصروفاً`);
    const month = fp.paidAt.toISOString().slice(0, 7);
    const [closed] = await db.select().from(monthCloses).where(and(eq(monthCloses.month, month), eq(monthCloses.status, "CLOSED")));
    if (closed) console.log(`  شهرُه ${month} مقفل — لا يُكتب`);
    else if (WRITE) {
      const reason = `فودكس: لا فاتورةَ لهذا السداد — مصروفٌ لا سدادُ فاتورة (${WHY})`;
      await db.transaction(async (t) => {
        await reversePayment(t, { paymentId: fp.id, kind: "VOID", reason, userId: AHMED });
        if (ft) {
          await t.update(bankTransactions).set({
            matchedPaymentId: null, matchStatus: "IGNORED", matchDisposition: null, matchOutcome: null, matchScore: null,
            category: "OTHER", supplierId: null, classificationSource: "HUMAN", classificationReason: reason,
            classificationVersion: CLASSIFICATION_VERSION, lifecycle: "CONFIRMED",
          }).where(eq(bankTransactions.id, ft.id));
          await t.insert(decisionHistory).values({ bankTransactionId: ft.id, event: "MATCH_REVERSED", actor: "HUMAN", actorId: AHMED, detail: reason,
            payload: { كانت: "سداد مورّد — فودكس", الباب: ft.category, "صار": "OTHER" } });
        }
        await recordAudit({ actorId: AHMED, action: "MATCH_UNDONE", entityType: "bank_transaction", entityId: ft?.id ?? fp.id,
          before: { الدفعة: fp.id, الباب: ft?.category ?? null }, after: { الفعل: "ليست سداداً لفاتورة — مصروف «أخرى»", السبب: reason } }, t);
      });
      const d = await deriveOpenMonths([month], AHMED);
      console.log(`  مصروفاتٌ قُيِّدت من البنك: ${d.created}`);
    }
  } else console.log(`فودكس: ${fp ? `حالُه ${fp.status} — لا شيء` : "لم يُوجد"}`);

  /* ٣. كشوفٌ لا يستقيم حسابُها بقراءةٍ واحدة — والأشهرُ المقفلة تُفتح ثمّ تُقفل */
  const MONTHS = ["2026-05", "2026-06"];
  const closed = await db.select().from(monthCloses).where(and(inArray(monthCloses.month, MONTHS), eq(monthCloses.status, "CLOSED")));
  if (WRITE) for (const c of closed) {
    await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
    await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month, before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
  }
  try {
    const all = await db.select({ id: statements.id, supplierId: statements.supplierId, documentId: statements.documentId, ob: statements.openingBalanceMinor, cb: statements.closingBalanceMinor, name: suppliers.nameAr, file: documents.fileName })
      .from(statements).innerJoin(suppliers, eq(suppliers.id, statements.supplierId)).innerJoin(documents, eq(documents.id, statements.documentId));
    for (const st of all) {
      const lines = (await db.select({ date: statementLines.date, ref: statementLines.ref, description: statementLines.description, debitMinor: statementLines.debitMinor, creditMinor: statementLines.creditMinor })
        .from(statementLines).where(eq(statementLines.statementId, st.id)).orderBy(asc(statementLines.date), asc(statementLines.id)));
      const fixed = repairStatementArithmetic(lines, st.ob, st.cb);
      if (!fixed) continue;
      const what = fixed.openingMinor !== st.ob ? `الافتتاحيُّ ${(st.ob ?? 0) / 100} ← ${fixed.openingMinor / 100}` : "مبلغُ سطرٍ قُرئ رصيدَه";
      const r = await reconcileAndPersist({ statementId: st.id, supplierId: st.supplierId, supplierName: st.name, documentId: st.documentId,
        lines: fixed.lines, openingMinor: fixed.openingMinor, closingMinor: st.cb, actorId: AHMED, persist: WRITE, note: `${what} — ${WHY}` });
      console.log(`${st.name} · ${st.file}: ${what} · طوبق ${r.result.matchedCount}/${fixed.lines.length}`);
    }

    const [hm] = await db.select().from(payments).where(eq(payments.id, HUNGRY_MAN_PAYMENT));
    if (hm && hm.paidAt.getTime() !== HUNGRY_MAN_PAID.getTime()) {
      console.log(`هنقري مان: سدادُ ${hm.amountMinor / 100} من ${hm.paidAt.toISOString().slice(0, 10)} ← 2026-06-05 (كشفُه: FT26156PLPFN)`);
      if (WRITE) {
        await db.update(payments).set({ paidAt: HUNGRY_MAN_PAID }).where(eq(payments.id, hm.id));
        await recordAudit({ actorId: AHMED, action: "PAYMENT_RECORDED", entityType: "payment", entityId: hm.id,
          before: { التاريخ: hm.paidAt.toISOString().slice(0, 10) },
          after: { التاريخ: "2026-06-05", السبب: `كشفُ هنقري مان يذكر وصولَها ٥ يونيو «حوالة سداد شهر مايو (FT26156PLPFN)»، وكانت بيومِ الشهر — ${WHY}` } });
      }
    }
  } finally {
    if (WRITE) for (const c of closed) {
      const checklist = { ...(c.checklist as Record<string, unknown>), أُعيد_إقفاله: WHY };
      await db.update(monthCloses).set({ status: "CLOSED", checklist: checklist as never, closedById: AHMED, closedAt: new Date() }).where(eq(monthCloses.id, c.id));
      await recordAudit({ actorId: AHMED, action: "MONTH_CLOSED", entityType: "month_close", entityId: c.month, after: { السبب: WHY } });
    }
  }

  /* ٤. تنبيهاتُ الكشوف */
  const stale = await db.select({ id: issues.id }).from(issues).where(and(
    eq(issues.entityType, "statement"), eq(issues.code, "STATEMENT_AMOUNT_MISMATCH"), eq(issues.status, "OPEN"), like(issues.message, "كشفُه يقول%")));
  const sts = await db.select({ id: statements.id }).from(statements);
  console.log(`فرقُ الدفتر برمزه القديم: ${stale.length} · كشوفٌ تُعاد تنبيهاتُها: ${sts.length}`);
  if (WRITE) {
    await db.transaction(async (t) => {
      if (stale.length) await t.delete(issues).where(inArray(issues.id, stale.map((s) => s.id)));
      for (const s of sts) await refreshStatementFindings(t, s.id);
    });
  }
  const open = (await db.execute<{ name_ar: string; code: string; message: string }>(sql`
    select s.name_ar, i.code, i.message from issues i join statements st on st.id = i.entity_id join suppliers s on s.id = st.supplier_id
     where i.entity_type = 'statement' and i.status = 'OPEN' and i.code <> 'INVOICE_NOT_IN_STATEMENT' order by 1`)).rows;
  console.log("\nتنبيهاتُ الكشوف المفتوحة:");
  for (const o of open) console.log(`  ${o.name_ar} · ${o.code}: ${o.message}`);
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
