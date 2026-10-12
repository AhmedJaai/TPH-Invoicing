/**
 * أفال والغربية (١٢ أكتوبر ٢٠٢٦، بقول أحمد وإذنه بفتح الأشهر والحذف):
 *
 *   ١. أفال INV-2026-00080 (١٣ أغسطس، ‏١٬٩٩٨٫٧٠) ألغاها المورّد لخطأٍ في سعر بند وأصدر مكانها
 *      INV-2026-00084 (١٥ أغسطس، ‏١٬٩٤٤٫٩٤). كانتا مقيَّدتين معاً فحُسب التوريدُ مرّتين. تُلغى 00080:
 *      مستندُها «مرفوض» بسببه، وقيدُها يسقط، وما خُصّص عليها من حوالة ٢٦ أغسطس يعود رصيداً
 *      عند أفال (الحوالةُ ‏٨٬٤٠٢٫٧٧ دفعت الاثنتين فعلاً — كشفُ أفال حملهما معاً)، وسطرُ كشفه
 *      S00102 يعود «غير مطابَق». ولا يُمسّ ملفُّها في الدرايف.
 *
 *   ٢. الغربية 264343949 (٥ يونيو): المقيَّدُ ‏٣٬٤٠٠ (سومطرة ٢٠ وعنب ١٠) والصحيحُ ‏١٬٧٠٠ (سومطرة ١٠
 *      وعنب ٥ — كما في فودكس). حذف أحمد الملفَّ الخطأ من الدرايف ورفع الصحيح، ومجلّدُ يونيو
 *      خارج نافذة المزامنة فلم يدخل. يُقرأ هنا ويُقيَّد مستنداً ثمّ يحلّ محلّ المقيَّدة
 *      (`replaceWithCorrectedInvoice`): القيدُ نفسُه ينتقل، وما سُدِّد فوقه (‏١٬٧٠٠) يعود رصيداً.
 *      الملفُّ بلا رقمٍ مطبوع وبنودُه مشوّشة القراءة («كولوميبعن بن»)، فرقمُه من اسمه وبنودُه
 *      بأسمائها المقيَّدة — والكمّيّاتُ والأسعارُ كما قُرئت.
 *
 *   ٣. بندُ «كولومبي عنب» للغربية كان مربوطاً بصنفٍ مكرَّر بلا عبوة فلم يُعدّ شراءً للعنب:
 *      يُربط بـ«Colombia grabes» كيلوً. وبندُ أوغندا لأفال (00188) كانت عبوتُه «٥ كجم» فحُسبت
 *      الخمسةُ خمسةً وعشرين: تصير كيلوً.
 *
 *   يونيو وأغسطس يُفتحان ثمّ يُقفلان. كلُّه في معاملةٍ واحدة، وإعادتُه لا تغيّر شيئاً.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-12.ts [--i-know-this-is-production]
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, invoices, monthCloses, paymentAllocations, statementLines, supplierProducts } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { companyConfig } from "@/config/drive";
import { downloadFile, driveForUser, getFileMeta } from "@/lib/drive";
import { extractDocument } from "@/lib/extraction";
import { SETTLEMENT_FORWARD_DAYS } from "@/lib/allocation";
import { refreshTokenFor } from "@/services/drive.service";
import { refreshPaymentStatus } from "@/services/payment.service";
import { applySupplierCredit } from "@/services/supplier-credit.service";
import { refreshStatementFindings } from "@/services/statement-reconcile.service";
import { replaceWithCorrectedInvoice } from "@/services/invoice-replace.service";
import { savePurchaseLink } from "@/services/inventory-purchase-link.service";
import { saveCachedReading } from "@/services/reading-cache.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const AVAL = "ebb5403b-2ca8-495a-900a-d823e992f2df";
const GHARBIA = "a7fad838-618d-4d46-8bb2-f49c840f451d";

const AVAL_80 = "1083b6b6-9cfe-4bfc-98db-271acea729e7";
const AVAL_80_DOC = "73cd5ea0-c0aa-4021-9d87-8d9c1bfa8188";
const GHARBIA_INVOICE = "6d925bd6-4b13-467d-867e-e345e7b46822";
const GHARBIA_NEW_FILE = "1p9a3d0AJudkoURWCD_jfkiOl9pHK-BKR";
const GHARBIA_NUMBER = "264343949";
const GHARBIA_TOTAL = 170_000;

/** صنفُ المورّد ← صنفُ الجرد، كيلوً واحداً */
const LINKS = [
  { supplierProductId: "90d52519-6f85-424c-b8ba-f2324fb96c65", productId: "ec00dec9-25d7-4ff0-aba8-0e5dde3e50da", what: "الغربية «كولومبي عنب» ← Colombia grabes" },
  { supplierProductId: "c6726bc9-e4d6-4dbe-86fb-d0e6d9d859a7", productId: "333abd26-9ecc-49bf-90ba-56a94057b179", what: "أفال أوغندا (00188) ← Uganda، كيلو لا خمسة" },
] as const;

const MONTHS = ["2026-06", "2026-08"];
const WHY_AVAL = "ألغاها المورّد لخطأٍ في سعر بند — استُبدلت بـINV-2026-00084 (بقول أحمد ١٢ أكتوبر ٢٠٢٦، نفّذه Claude)";
const WHY = "أفال 00080 ملغاة بـ00084، وفاتورةُ الغربية 264343949 صُحِّحت إلى ‏١٬٧٠٠ — بقول أحمد وإذنه (١٢ أكتوبر ٢٠٢٦)، نفّذه Claude";

async function state(label: string) {
  const rows = (await db.execute<{ supplier: string; number: string; total: number; paid: string }>(sql`
    select case when i.supplier_id = ${AVAL} then 'أفال' else 'الغربية' end as supplier, i.invoice_number as number, i.total_minor as total,
           coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as paid
      from invoices i
     where (i.supplier_id = ${AVAL} and i.invoice_date >= '2026-08-01') or i.id = ${GHARBIA_INVOICE}
     order by i.supplier_id, i.invoice_date
  `)).rows;
  const credit = (await db.execute<{ supplier: string; credit: string }>(sql`
    select case when p.supplier_id = ${AVAL} then 'أفال' else 'الغربية' end as supplier,
           sum(p.amount_minor - coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.payment_id = p.id), 0))::bigint as credit
      from payments p
     where p.supplier_id in (${AVAL}, ${GHARBIA}) and p.status not in ('VOID', 'REVERSED')
     group by p.supplier_id
  `)).rows;
  console.log(`\n${label}`);
  for (const r of rows) console.log(`  ${r.supplier}  ${r.number}  إجمالي ${Number(r.total) / 100}  مخصَّص ${Number(r.paid) / 100}`);
  for (const c of credit) console.log(`  رصيدٌ لنا عند ${c.supplier} (غير مخصَّص): ${Number(c.credit) / 100}`);
}

/** يقرأ ملفَّ الغربية الصحيح من الدرايف — قراءةً فقط — ويعيد صفَّ مستنده جاهزاً للإدراج. */
async function readGharbiaFile() {
  const token = await refreshTokenFor(AHMED);
  if (!token) throw new Error("لا تفويضَ للدرايف");
  const drive = driveForUser(token);
  const meta = await getFileMeta(drive, GHARBIA_NEW_FILE);
  if (!meta) throw new Error("ملفُّ الغربية الصحيح ليس في الدرايف");
  const { data, mimeType } = await downloadFile(drive, GHARBIA_NEW_FILE);
  const extraction = await extractDocument({
    data, mimeType, companyVat: companyConfig.vatNumber, companyName: companyConfig.nameAr,
    supplierNames: ["محمصة الغربية (western-roastery)"],
  });
  if (!extraction.ok) throw new Error(`تعذّرت قراءةُ الملفّ: ${JSON.stringify(extraction).slice(0, 200)}`);
  const x = extraction.value;
  const read = (x.lines ?? []).filter((l) => l.lineTotal).map((l) => `${l.description} ${l.quantity}×${l.unitPrice}=${l.lineTotal}`);
  console.log(`\nقراءةُ ملفّ الغربية الجديد: الإجمالي «${x.totalAmount}» · التاريخ ${x.invoiceDate} · ${read.join(" | ")}`);
  /* الحارس: ما قُرئ يوافق ما قاله أحمد — وإلّا فلا تصحيحَ بيدٍ على قراءةٍ أخرى */
  const digits = (s: string | undefined) => (s ?? "").replace(/[^\d.]/g, "");
  if (Number(digits(x.totalAmount)) !== GHARBIA_TOTAL / 100) throw new Error(`الإجماليّ المقروء «${x.totalAmount}» ليس ‏١٬٧٠٠`);
  const priced = (x.lines ?? []).filter((l) => l.lineTotal);
  const has = (qty: string, total: string) => priced.some((l) => digits(l.quantity) === qty && Number(digits(l.lineTotal)) === Number(total));
  if (priced.length !== 2 || !has("5", "800") || !has("10", "900")) throw new Error("البنودُ المقروءة ليست (٥ × ١٦٠) و(١٠ × ٩٠)");

  const reading = {
    ...x,
    invoiceNumber: GHARBIA_NUMBER,
    subtotalAmount: "1700.00",
    totalAmount: "1700.00",
    chargesAmount: "",
    lines: [
      { description: "بن سومطرة", quantity: "10", unitPrice: "90.00", lineTotal: "900.00" },
      { description: "كولومبي عنب", quantity: "5", unitPrice: "160.00", lineTotal: "800.00" },
    ],
  };
  const sha256 = createHash("sha256").update(data).digest("hex");
  return { meta, data, mimeType, extraction, reading, sha256 };
}

async function main() {
  console.log(WRITE ? "وضعُ الكتابة — قاعدةُ الإنتاج" : "تجربةٌ بلا كتابة (أضِف --i-know-this-is-production للتنفيذ)");
  await state("قبل:");

  const [avalInvoice] = await db.select({ id: invoices.id, number: invoices.invoiceNumber, total: invoices.totalMinor, date: invoices.invoiceDate, month: invoices.periodMonth })
    .from(invoices).where(eq(invoices.id, AVAL_80));
  const [gharbia] = await db.select({ total: invoices.totalMinor }).from(invoices).where(eq(invoices.id, GHARBIA_INVOICE));
  const gharbiaDone = gharbia?.total === GHARBIA_TOTAL;
  const links = await db.select({ id: supplierProducts.id, productId: supplierProducts.productId, cq: supplierProducts.contentQuantity, cu: supplierProducts.contentUnit })
    .from(supplierProducts).where(inArray(supplierProducts.id, LINKS.map((l) => l.supplierProductId)));
  const linkDone = (l: (typeof LINKS)[number]) => {
    const cur = links.find((x) => x.id === l.supplierProductId);
    return cur?.productId === l.productId && Number(cur.cq) === 1 && cur.cu === "KG";
  };

  console.log(`\nالخطّة:`);
  console.log(`  ١. أفال 00080: ${avalInvoice ? "تُلغى" : "أُلغيت من قبل"}`);
  console.log(`  ٢. الغربية ${GHARBIA_NUMBER}: ${gharbiaDone ? "صُحِّحت من قبل" : "تُستبدل بالصحيحة ‏١٬٧٠٠"}`);
  for (const l of LINKS) console.log(`  ٣. ${l.what}: ${linkDone(l) ? "مربوطٌ من قبل" : "يُربط"}`);

  const file = gharbiaDone ? null : await readGharbiaFile();
  if (!WRITE) { console.log("\nلم يُكتب شيء."); process.exit(0); }

  const closed = await db.select().from(monthCloses).where(and(inArray(monthCloses.month, MONTHS), eq(monthCloses.status, "CLOSED")));
  for (const c of closed) {
    await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
    await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month, before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
  }
  try {
    await db.transaction(async (t) => {
      /* ── ١. أفال 00080 ── */
      if (avalInvoice) {
        const released = await t.delete(paymentAllocations).where(eq(paymentAllocations.invoiceId, AVAL_80))
          .returning({ paymentId: paymentAllocations.paymentId, amountMinor: paymentAllocations.amountMinor });
        for (const p of new Set(released.map((r) => r.paymentId))) await refreshPaymentStatus(t, p);
        const lines = await t.update(statementLines).set({ matchedInvoiceId: null, matchStatus: "UNMATCHED" })
          .where(eq(statementLines.matchedInvoiceId, AVAL_80)).returning({ id: statementLines.id, statementId: statementLines.statementId, ref: statementLines.ref });
        await t.update(documents).set({ status: "REJECTED", statusNote: WHY_AVAL }).where(eq(documents.id, AVAL_80_DOC));
        await t.delete(invoices).where(eq(invoices.id, AVAL_80));
        for (const s of new Set(lines.map((l) => l.statementId))) await refreshStatementFindings(t, s);
        await recordAudit({
          actorId: AHMED, action: "DOCUMENT_REJECTED", entityType: "document", entityId: AVAL_80_DOC,
          before: {
            "فواتير أُسقطت معه": [{ المعرّف: avalInvoice.id, الرقم: avalInvoice.number, المورّد: AVAL, الإجمالي: avalInvoice.total, التاريخ: avalInvoice.date, الشهر: avalInvoice.month }],
            "تخصيصات فُكّت": released.map((r) => ({ الدفعة: r.paymentId, المبلغ: r.amountMinor })),
            "سطور كشف فُكّت": lines.map((l) => ({ السطر: l.id, المرجع: l.ref })),
          },
          after: { السبب: WHY_AVAL, البديلة: "INV-2026-00084" },
        }, t);
        await applySupplierCredit(t, AVAL, { forwardDays: SETTLEMENT_FORWARD_DAYS });
      }

      /* ── ٢. الغربية ── */
      if (file) {
        const [doc] = await t.insert(documents).values({
          driveFileId: GHARBIA_NEW_FILE,
          driveFolderId: file.meta.parents?.[0] ?? null,
          fileName: file.meta.name,
          mimeType: file.mimeType,
          sizeBytes: file.data.length,
          sha256: file.sha256,
          driveMd5: file.meta.md5Checksum ?? createHash("md5").update(file.data).digest("hex"),
          kind: "SIMPLIFIED_INVOICE",
          status: "NEEDS_REVIEW",
          periodMonth: "2026-06",
          supplierId: GHARBIA,
          extractionJson: file.reading as never,
          extractionModel: file.extraction.model,
          extractionEvidence: file.extraction.evidence ?? null,
          extractionPromptVersion: file.extraction.evidence?.promptVersion ?? null,
          textSource: file.extraction.textSource ?? null,
          fieldConfidence: file.extraction.value.confidence as never,
          uploadedById: AHMED,
          readAttempts: 1,
          lastReadAt: new Date(),
          source: "DRIVE_SYNC",
          originalFileName: file.meta.name,
        }).onConflictDoNothing().returning({ id: documents.id });
        if (!doc) throw new Error("مستندُ الغربية الجديد مقيَّدٌ من قبل وقيدُه لم يُصحَّح — يُفحص باليد");
        await recordAudit({
          actorId: AHMED, action: "DOCUMENT_RECORDED_BY_HAND", entityType: "document", entityId: doc.id,
          after: {
            الملف: file.meta.name, المصدر: "الدرايف — مجلّد يونيو خارج نافذة المزامنة",
            "صُحِّح في القراءة": "رقمُ الفاتورة من اسم الملفّ، وأسماءُ البندين بأسمائهما المقيَّدة (القراءةُ مشوّشة) — الكمّيّاتُ والأسعارُ كما قُرئت",
            السبب: WHY,
          },
        }, t);
        const out = await replaceWithCorrectedInvoice(t, doc.id, AHMED);
        await t.update(documents).set({ statusNote: "حلّت محلّها الفاتورةُ المصحَّحة (‏١٬٧٠٠) — حذف أحمد ملفَّها من الدرايف" }).where(eq(documents.id, out.oldDocumentId));
        console.log(`\nالغربية: ${out.beforeMinor / 100} ← ${out.afterMinor / 100} · عاد رصيداً ${out.releasedMinor / 100}`);
      }

      /* ── ٣. الربط ── */
      for (const l of LINKS) {
        if (linkDone(l)) continue;
        await savePurchaseLink({ supplierProductId: l.supplierProductId, productId: l.productId, packSize: "1", contentQuantity: "1", contentUnit: "KG" }, AHMED, t);
      }

      /* ── الفحص: وإلّا تُلغى المعاملةُ كلُّها ── */
      const [left] = await t.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, AVAL_80));
      if (left) throw new Error("00080 ما زالت مقيَّدة");
      const [g] = (await t.execute<{ total: number; paid: string }>(sql`
        select i.total_minor as total, coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as paid
          from invoices i where i.id = ${GHARBIA_INVOICE}`)).rows;
      if (Number(g.total) !== GHARBIA_TOTAL || Number(g.paid) !== GHARBIA_TOTAL) throw new Error(`الغربية: إجمالي ${g.total} ومخصَّص ${g.paid} — المنتظَر ${GHARBIA_TOTAL}`);
    });
    if (file) await saveCachedReading(file.sha256, file.extraction, AHMED);
    console.log("\nصُحِّح.");
  } finally {
    for (const c of closed) {
      const checklist = { ...(c.checklist as Record<string, unknown>), أُعيد_إقفاله: WHY };
      await db.update(monthCloses).set({ status: "CLOSED", checklist: checklist as never, closedById: AHMED, closedAt: new Date() }).where(eq(monthCloses.id, c.id));
      await recordAudit({ actorId: AHMED, action: "MONTH_CLOSED", entityType: "month_close", entityId: c.month, after: { السبب: WHY } });
    }
  }
  await state("بعد:");
  process.exit(0);
}

main().catch((e) => { console.error("✕", e); process.exit(1); });
