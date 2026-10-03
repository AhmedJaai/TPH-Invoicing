/**
 * زاكوباك (٣ أكتوبر ٢٠٢٦، بإذن أحمد):
 *   ١. فاتورة 3068 («3068.pdf»، ٩ سبتمبر، ١٬٠٧٩٫٩٠) طُبعت بـ«Microsoft Print To PDF» فلم تُقرأ،
 *      ثمّ اعتُمدت بلا قيد. تُقرأ برسم الصفحة (`rereadDocument`) وتُقيَّد (`recordDocumentByHand`).
 *   ٢. سدادا 2823 (١٬٣٦٨٫٩٠) و2894 (٦٥٧٫٨٠) سُجّلا بيد «من دفعة أوّل الشهر» ولم يقع سدادٌ لهما
 *      في أغسطس — سدّدهما أحمد مع فاتورة سبتمبر دفعةً واحدة بعد. يُلغيان (VOID بسببهما)
 *      فتعود الفاتورتان مستحقّتين حتى تصل الحوالة. وأغسطس يُفتح ثمّ يُقفل.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-03e.ts [--i-know-this-is-production]
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, documents, invoices, monthCloses, paymentAllocations, payments, suppliers } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { driveForCli } from "@/lib/drive";
import { rereadDocument } from "@/services/document-reread.service";
import { recordDocumentByHand } from "@/services/document-record.service";
import { reversePayment } from "@/services/payment.service";
import type { StoredReading } from "@/services/document-backlog.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const DOC_3068 = "2bf107bf-d306-465a-b02b-7b93c080dcd0";
const HAND_PAYMENTS = ["20e8f52c-d0bd-4c1a-a20f-f2674e4a9e39", "95e1c498-5fc8-4a72-aea1-dce88dc6e58b"];
const WHY = "لم يقع سدادٌ لهما في أغسطس — سُدّدتا مع فاتورة سبتمبر دفعةً واحدة بعد (أحمد، ٣ أكتوبر ٢٠٢٦)";

async function main() {
  console.log(WRITE ? "— كتابة —" : "— معاينة (لا تُكتب) —");

  /* ١. فاتورة 3068 */
  const [inv] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.documentId, DOC_3068));
  if (inv) console.log("3068: مقيَّدةٌ من قبل — لا شيء");
  else if (WRITE) {
    const drive = await driveForCli(async () =>
      (await db.select({ t: accounts.refresh_token }).from(accounts).where(eq(accounts.provider, "google")).limit(1))[0]?.t ?? null);
    const r = await rereadDocument({ documentId: DOC_3068, actorId: AHMED, drive, apply: true });
    if (!r.ok) throw new Error(`تعذّرت القراءة: ${r.error}`);
    const [d] = await db.select({ reading: documents.extractionJson, supplierId: documents.supplierId, kind: documents.kind }).from(documents).where(eq(documents.id, DOC_3068));
    const x = d.reading as StoredReading;
    const [zaco] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.slug, "Zacopack"));
    const out = await recordDocumentByHand(AHMED, {
      documentId: DOC_3068, kind: "TAX_INVOICE", supplierId: d.supplierId ?? zaco.id,
      invoiceNumber: x.invoiceNumber ?? "", invoiceDate: x.invoiceDate ?? "", subtotal: x.subtotalAmount, vat: x.vatAmount, total: x.totalAmount ?? "",
      sellerVat: x.sellerVatNumber, buyerVat: x.buyerVatNumber,
    }, false);
    console.log(`3068: قُرئت (${x.invoiceNumber} · ${x.invoiceDate} · ${x.totalAmount}) · قُيِّدت ${out.invoiceId ? "نعم" : "لا"} · ${out.review.taxStatus}${out.review.blockers.length ? ` · ${out.review.blockers.map((b) => b.message).join("؛ ")}` : ""}`);
    if (out.invoiceId) await db.update(documents).set({ status: "ARCHIVED" }).where(eq(documents.id, DOC_3068));
  } else console.log("3068: تُقرأ برسم الصفحة وتُقيَّد");

  /* ٢. السدادان اليدويّان */
  const ps = await db.select({ id: payments.id, paidAt: payments.paidAt, amount: payments.amountMinor, status: payments.status })
    .from(payments).where(inArray(payments.id, HAND_PAYMENTS));
  const live = ps.filter((p) => p.status !== "VOID" && p.status !== "REVERSED");
  for (const p of ps) console.log(`سدادٌ يدويّ ${p.paidAt.toISOString().slice(0, 10)} · ${p.amount / 100} · ${p.status}${live.includes(p) ? " ← يُلغى" : ""}`);
  if (!WRITE || live.length === 0) process.exit(0);

  const months = [...new Set(live.map((p) => p.paidAt.toISOString().slice(0, 7)))];
  const closed = await db.select().from(monthCloses).where(and(inArray(monthCloses.month, months), eq(monthCloses.status, "CLOSED")));
  for (const c of closed) {
    await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
    await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month, before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
  }
  try {
    for (const p of live) {
      await db.transaction(async (t) => {
        const allocs = await t.select({ inv: paymentAllocations.invoiceId }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, p.id));
        await reversePayment(t, { paymentId: p.id, kind: "VOID", reason: WHY, userId: AHMED });
        await recordAudit({ actorId: AHMED, action: "PAYMENT_VOIDED", entityType: "payment", entityId: p.id,
          before: { الحال: p.status, المبلغ: p.amount, الفواتير: allocs.map((a) => a.inv) }, after: { الحال: "VOID", السبب: WHY } }, t);
      });
      console.log(`  أُلغي ${p.amount / 100}`);
    }
  } finally {
    for (const c of closed) {
      const checklist = { ...(c.checklist as Record<string, unknown>), أُعيد_إقفاله: WHY };
      await db.update(monthCloses).set({ status: "CLOSED", checklist: checklist as never, closedById: AHMED, closedAt: new Date() }).where(eq(monthCloses.id, c.id));
      await recordAudit({ actorId: AHMED, action: "MONTH_CLOSED", entityType: "month_close", entityId: c.month, after: { السبب: WHY } });
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
