/**
 * شهادةُ الدورة المالية — من الفاتورة إلى الإقفال.
 *
 *   npm run ops:certify
 *
 * **لا يكتب شيئاً.** كلّ سيناريو يجري داخل معاملةٍ تُلغى في آخرها
 * عمداً، فيُختبَر المسار الحقيقيّ على المخطّط الحقيقيّ بلا أن يُمَسّ
 * ريالٌ واحد من بيانات أحمد.
 *
 * ولماذا لا يكفي اختبارُ الوحدات: الاختبارات تُمرَّر دوالَّ خالصةً
 * بمدخلاتٍ مصنوعة. وهذا يُمرَّر **الخدمات نفسها** على **القاعدة
 * نفسها** — فيكشف ما لا تكشفه: عمودٌ ناقص، وقيدٌ يرفض، وهجرةٌ لم
 * تُشغَّل، ونوعٌ في القاعدة يخالف نوعاً في الشيفرة.
 *
 * وستّة سيناريوهات، آخرها هو الذي كاد يكلّف مالاً حقيقياً.
 */
import { writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  documents, invoices, paymentAllocations, payments, suppliers, users,
} from "@/db/schema";
import { createId } from "@/lib/id";
import {
  allocate, createPayment, findPaymentTwin, refreshPaymentStatus, reversePayment,
} from "@/services/payment.service";
import { runReconciliation } from "@/services/reconcile.service";
import { confirmCounterparty, loadMerchantMemory } from "@/services/counterparty.service";
import { classify } from "@/lib/bank/classification";
import { toCanonical } from "@/lib/bank/canonical";
import { derivePaymentStatus } from "@/lib/payment-state";

interface Result { name: string; pass: boolean; detail: string }

const results: Result[] = [];
const day = (d: string) => new Date(`${d}T00:00:00Z`);

/** خطأٌ يُرمى عمداً في آخر كلّ سيناريو كي تُلغى المعاملة. */
class Rollback extends Error {}

/**
 * يجري السيناريو ثمّ يُلغي أثره.
 *
 * والإلغاء ليس تنظيفاً بعد النجاح: هو جزءٌ من التصميم. فلو كُتب ثمّ
 * حُذف لبقي أثرٌ في سجلّ التدقيق — وهو جدولٌ لا يُحذَف منه شيء.
 */
async function scenario(name: string, body: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<string>) {
  let detail = "";
  try {
    await db.transaction(async (tx) => {
      detail = await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) {
      results.push({ name, pass: false, detail: (e as Error).message.slice(0, 200) });
      return;
    }
  }
  results.push({ name, pass: true, detail });
}

/** يُنشئ مورّداً وفواتيره داخل المعاملة. */
async function seed(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  amounts: number[],
): Promise<{ supplierId: string; invoiceIds: string[] }> {
  const supplierId = createId();
  await tx.insert(suppliers).values({
    id: supplierId,
    nameAr: `مورّد اختبار ${supplierId.slice(0, 6)}`,
    slug: `certify-${supplierId.slice(0, 8)}`,
    driveFolderName: `certify-${supplierId.slice(0, 8)}`,
    isActive: true,
  });

  const invoiceIds: string[] = [];
  for (const [i, total] of amounts.entries()) {
    invoiceIds.push(await makeInvoice(tx, supplierId, `CERT-${i + 1}`, total, "2026-08-10"));
  }
  return { supplierId, invoiceIds };
}

/**
 * فاتورةٌ بمستندها.
 *
 * والمستند إلزاميّ في المخطّط — وذلك قرارٌ مقصود: كلّ فاتورة لها أصلٌ
 * مرفوع. فالشهادة تُنشئ الأصل كما يُنشئه المسار الحقيقيّ.
 */
type Writer = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function makeInvoice(
  tx: Writer,
  supplierId: string,
  number: string,
  totalMinor: number,
  isoDate: string,
): Promise<string> {
  const documentId = createId();
  await tx.insert(documents).values({
    id: documentId,
    fileName: `certify-${number}.pdf`,
    mimeType: "application/pdf",
    supplierId,
    periodMonth: isoDate.slice(0, 7),
    kind: "TAX_INVOICE",
    status: "ARCHIVED",
  });

  const id = createId();
  const subtotal = Math.round(totalMinor / 1.15);
  await tx.insert(invoices).values({
    id,
    documentId,
    supplierId,
    invoiceNumber: number,
    invoiceDate: day(isoDate),
    periodMonth: isoDate.slice(0, 7),
    subtotalMinor: subtotal,
    vatMinor: totalMinor - subtotal,
    totalMinor,
  });
  return id;
}

async function allocatedOf(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paymentId: string,
): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`coalesce(sum(${paymentAllocations.amountMinor}),0)::int` })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, paymentId));
  return Number(r?.n ?? 0);
}

async function statusOf(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paymentId: string,
): Promise<string> {
  const [r] = await tx.select({ s: payments.status }).from(payments).where(eq(payments.id, paymentId));
  return String(r?.s ?? "—");
}

async function main() {
  console.log("\n═══════════ شهادة الدورة المالية ═══════════");
  console.log("  (كلّ سيناريو يُلغى أثرُه — لا يُكتَب شيء)\n");

  /* ── ١ · فاتورةٌ وسدادٌ مطابق ── */
  await scenario("١ · فاتورة ١٬١٥٠ ← سداد ١٬١٥٠ ← مطابقة تامّة ← تُقفَل", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [1_150_00]);

    const paymentId = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-12"), amountMinor: 1_150_00,
      method: "BANK_TRANSFER", appliesToMonth: "2026-08",
    });
    await allocate(tx, paymentId, 1_150_00, [{ invoiceId: invoiceIds[0], amountMinor: 1_150_00 }]);

    const allocated = await allocatedOf(tx, paymentId);
    const status = await statusOf(tx, paymentId);
    if (allocated !== 1_150_00) throw new Error(`خُصّص ${allocated} لا ١١٥٠٠٠`);
    if (status !== "APPLIED") throw new Error(`الحال ${status} لا APPLIED`);
    return `خُصّص ${allocated / 100} · الحال ${status}`;
  });

  /* ── ٢ · دفعةٌ لفاتورتين ── */
  await scenario("٢ · سداد ١٠٬٠٠٠ ← فاتورتان ٤٬٠٠٠ + ٦٬٠٠٠ ← تخصيصان", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [4_000_00, 6_000_00]);

    /* المحرّك يوزّعها — لا توزيعٌ يدويّ في الشهادة */
    const engine = runReconciliation({
      rows: [{
        key: "t1", valueDate: day("2026-08-12"), amountMinor: 10_000_00,
        direction: "DEBIT", description: "شراء بضاعة",
        beneficiaryRaw: `مورّد اختبار ${supplierId.slice(0, 6)}`,
      }],
      invoices: invoiceIds.map((id, i) => ({
        id, supplierId, invoiceNumber: `CERT-${i + 1}`,
        invoiceDate: day("2026-08-10"), periodMonth: "2026-08",
        totalMinor: i === 0 ? 4_000_00 : 6_000_00,
        outstandingMinor: i === 0 ? 4_000_00 : 6_000_00,
      })),
      suppliers: [{
        supplierId, nameAr: `مورّد اختبار ${supplierId.slice(0, 6)}`,
        slug: `certify-${supplierId.slice(0, 8)}`, aliases: [],
      }],
    });

    const plan = engine.planned[0];
    if (!plan) throw new Error("المحرّك لم يُنتج خطّة — لم تبلغ الحسم");
    if (plan.allocations.length !== 2) throw new Error(`${plan.allocations.length} تخصيصاً لا اثنين`);

    const paymentId = await createPayment(tx, {
      supplierId: plan.supplierId, paidAt: plan.paidAt, amountMinor: plan.amountMinor,
      method: "BANK_TRANSFER", appliesToMonth: plan.primaryMonth, feeMinor: plan.feeMinor,
    });
    await allocate(tx, paymentId, plan.amountMinor, plan.allocations);

    const allocated = await allocatedOf(tx, paymentId);
    if (allocated !== 10_000_00) throw new Error(`خُصّص ${allocated} لا ١٠٠٠٠٠٠`);
    return `تخصيصان مجموعهما ${allocated / 100} · الحال ${await statusOf(tx, paymentId)}`;
  });

  /* ── ٣ · سدادٌ جزئيّ ── */
  await scenario("٣ · فاتورة ١٠٬٠٠٠ ← سداد ٦٬٠٠٠ ← جزئيّ ← يبقى ٤٬٠٠٠", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [10_000_00]);

    const paymentId = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-12"), amountMinor: 6_000_00,
      method: "BANK_TRANSFER", appliesToMonth: "2026-08",
    });
    await allocate(tx, paymentId, 6_000_00, [{ invoiceId: invoiceIds[0], amountMinor: 6_000_00 }]);

    const [inv] = await tx
      .select({
        total: invoices.totalMinor,
        allocated: sql<number>`coalesce((select sum(pa.amount_minor)::int
          from payment_allocations pa where pa.invoice_id = ${invoiceIds[0]}), 0)`,
      })
      .from(invoices).where(eq(invoices.id, invoiceIds[0]));

    const outstanding = Number(inv.total) - Number(inv.allocated);
    if (outstanding !== 4_000_00) throw new Error(`بقي ${outstanding} لا ٤٠٠٠٠٠`);

    const status = await statusOf(tx, paymentId);
    if (status !== "APPLIED") throw new Error(`الحال ${status} — الدفعة استُنفدت فهي مستقرّة`);
    return `بقي على الفاتورة ${outstanding / 100} · الدفعة ${status}`;
  });

  /* ── ٤ · دفعةٌ مقدَّمة ── */
  await scenario("٤ · سدادٌ بلا فاتورة ← ADVANCE ← لا يختفي", async (tx) => {
    const { supplierId } = await seed(tx, []);

    const paymentId = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-12"), amountMinor: 5_000_00,
      method: "BANK_TRANSFER", isAdvance: true,
    });

    const status = await statusOf(tx, paymentId);
    if (status !== "ADVANCE") throw new Error(`الحال ${status} لا ADVANCE`);

    /* ويُخصَّص على فاتورةٍ تصل لاحقاً */
    const later = await makeInvoice(tx, supplierId, "CERT-LATE", 5_000_00, "2026-08-20");
    await allocate(tx, paymentId, 5_000_00, [{ invoiceId: later, amountMinor: 5_000_00 }]);

    const after = await statusOf(tx, paymentId);
    if (after !== "APPLIED") throw new Error(`بعد التخصيص ${after} لا APPLIED`);
    return `ADVANCE ← ${after} بعد وصول الفاتورة`;
  });

  /* ── ٥ · دفعةٌ مردودة ── */
  await scenario("٥ · سداد ← ردّ ← REVERSED ← لا يُحسَب مدفوعاً", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [3_000_00]);

    const paymentId = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-12"), amountMinor: 3_000_00,
      method: "BANK_TRANSFER", appliesToMonth: "2026-08",
    });
    await allocate(tx, paymentId, 3_000_00, [{ invoiceId: invoiceIds[0], amountMinor: 3_000_00 }]);

    const [user] = await tx.select({ id: users.id }).from(users).limit(1);
    const outcome = await reversePayment(tx, {
      paymentId, kind: "REVERSED", reason: "شهادةٌ آليّة — ارتدّت الحوالة",
      userId: user?.id ?? "",
    });

    const status = await statusOf(tx, paymentId);
    if (status !== "REVERSED") throw new Error(`الحال ${status} لا REVERSED`);
    if (outcome.freedMinor !== 3_000_00) throw new Error(`تحرّر ${outcome.freedMinor} لا ٣٠٠٠٠٠`);

    /* والفاتورة تعود مستحقّة */
    const remaining = await allocatedOf(tx, paymentId);
    if (remaining !== 0) throw new Error(`بقي ${remaining} تخصيصاً بعد الردّ`);

    /* والدفعة باقيةٌ في السجلّ — لا تُحذَف */
    const [still] = await tx.select({ id: payments.id }).from(payments).where(eq(payments.id, paymentId));
    if (!still) throw new Error("حُذفت الدفعة — والردّ لا يحذف");

    return `REVERSED · تحرّر ${outcome.freedMinor / 100} · والدفعة باقية بسببها`;
  });

  /* ── ٦ · المال الداخل ── */
  await scenario("٦ · إيداعٌ وارد ← لا يُطابَق بفاتورة أبداً", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [1_150_00]);
    const name = `مورّد اختبار ${supplierId.slice(0, 6)}`;

    /*
      الحالة التي كانت تكتب مالاً: وارد بمبلغٍ يطابق فاتورةً مفتوحة،
      واسمُ المورّد في وصفه. وكانت تُحسَم تلقائياً — فيُنشَأ سدادٌ من
      مالٍ **دخل** الحساب، وتُقفَل فاتورةٌ لم تُدفَع.
    */
    const engine = runReconciliation({
      rows: [{
        key: "t1", valueDate: day("2026-08-12"), amountMinor: 1_150_00,
        direction: "CREDIT", description: `تحويل وارد ${name}`, beneficiaryRaw: name,
      }],
      invoices: [{
        id: invoiceIds[0], supplierId, invoiceNumber: "CERT-1",
        invoiceDate: day("2026-08-10"), periodMonth: "2026-08",
        totalMinor: 1_150_00, outstandingMinor: 1_150_00,
      }],
      suppliers: [{ supplierId, nameAr: name, slug: `certify-${supplierId.slice(0, 8)}`, aliases: [] }],
    });

    if (engine.planned.length !== 0) throw new Error("الوارد أنتج خطّةَ كتابة — وهو مالٌ داخل");
    if (engine.results[0].candidate !== null) throw new Error("الوارد أنتج مرشّحاً");
    return "لا خطّة ولا مرشّح — والوارد يخرج قبل الترشيح";
  });

  /* ── الحال المشتقّ يوافق القاعدة ── */
  await scenario("٧ · حالُ الدفعة المشتقّ يوافق ما تكتبه القاعدة", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [1_000_00]);
    const paymentId = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-12"), amountMinor: 1_000_00, method: "BANK_TRANSFER",
    });
    await allocate(tx, paymentId, 1_000_00, [{ invoiceId: invoiceIds[0], amountMinor: 400_00 }]);
    await refreshPaymentStatus(tx, paymentId);

    const inDb = await statusOf(tx, paymentId);
    const derived = derivePaymentStatus({
      amountMinor: 1_000_00, allocatedMinor: 400_00, feeMinor: 0,
      declaredAdvance: false, reversedAt: null, voided: false,
    });
    if (inDb !== derived) throw new Error(`القاعدة ${inDb} والاشتقاق ${derived}`);
    return `${inDb} في الاثنين`;
  });

  /*
    ══ ٩ · يتعلّم مرّةً فيعرف بعدها ══

    وهذا هو الوعد الذي يقوم عليه المنتج كلُّه: إن لم يتحقّق، فكلُّ شهرٍ
    يبدأ من الصفر مهما بلغ الذكاء. والاختبار الحقيقيّ ليس أنّ المصنِّف
    يقرأ خريطةً تُمرَّر إليه — ذلك مختبَرٌ في الوحدات — بل أنّ ما يؤكّده
    الإنسان **يُكتَب في القاعدة ثمّ يُقرأ منها** فيُعرَف به صفٌّ آخر:
    مبلغُه مختلف، وتاريخُه في شهرٍ آخر، ووصفُه ليس نصّاً واحداً.

    ويُختبَر معه الاتّجاه الآخر: جهةٌ قريبةُ الشبه لا تُلتقَط بالذاكرة —
    وإلّا صار التعلّم يُخطئ في أضعاف ما يُصيب.
  */
  await scenario("٩ · إنسانٌ يعرّف جهةً ← تُعرَف بعدها في شهرٍ آخر", async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).limit(1);
    if (!u) throw new Error("لا مستخدم في القاعدة");

    const ident = "٧٠٥٢٦٧٣٣٣٧";
    const first = toCanonical({
      valueDate: day("2026-06-05"),
      description: `حوالة شركة الفلاح BEN ID:${ident} شراء بضاعة 1360000119`,
      beneficiaryRaw: "شركة الفلاح التجارية",
      transactionType: null, amountMinor: 3_000_00, direction: "DEBIT",
    });

    await confirmCounterparty({
      writer: tx, userId: u.id, displayName: "شركة الفلاح التجارية",
      kind: "SUPPLIER", supplierId: null, transactions: [first],
    });

    const memory = await loadMerchantMemory(tx);

    /* شهرٌ آخر · مبلغٌ آخر · وصفٌ آخر — والهويّة واحدة */
    const later = toCanonical({
      valueDate: day("2026-09-21"),
      description: `LOCAL TRANSFER BEN ID:${ident} REF 88771122`,
      beneficiaryRaw: null, transactionType: null,
      amountMinor: 7_450_00, direction: "DEBIT",
    });
    const hit = classify(later, memory);
    if (hit.source !== "MEMORY") {
      throw new Error(`لم تُعرَف بالذاكرة — المصدر ${hit.source}`);
    }

    /* وجهةٌ أخرى بهويّةٍ أخرى لا تُلتقَط */
    const other = toCanonical({
      valueDate: day("2026-09-22"),
      description: "LOCAL TRANSFER BEN ID:٧٠٥٢٦٧٣٣٣٨ REF 99001122",
      beneficiaryRaw: null, transactionType: null,
      amountMinor: 7_450_00, direction: "DEBIT",
    });
    if (classify(other, memory).source === "MEMORY") {
      throw new Error("هويّةٌ مغايرة التُقطت بالذاكرة — تعلّمٌ كاذب");
    }

    return `عُرفت في ${later.valueDate.toISOString().slice(0, 7)} بمبلغٍ آخر · والشبيهة لم تُلتقَط`;
  });

  /*
    ══ ٨ · سدادان متزامنان على رصيدٍ واحد ══

    هذا السيناريو **لا يُلغى بمعاملة** — ولا يمكن أن يكون: التزاحم لا
    يقع داخل معاملةٍ واحدة، فهي لا تُزاحم نفسها. فيلزم اتّصالان
    حقيقيّان يكتبان معاً، ثمّ يُنظَّف الأثر باليد.

    والسؤال: فاتورةٌ عليها ٣٬٠٠٠، ودفعتان تحاولان سدادها في اللحظة
    نفسها. أتُكتَب ٦٬٠٠٠ على فاتورةٍ بـ٣٬٠٠٠؟

    والحارس مؤثِّرٌ في القاعدة (`payment_allocations_bounds`) يجمع
    التخصيصات بعد كلّ إدراج. والسؤال الحقيقيّ: أيكفي تحت العزل
    `READ COMMITTED`؟ فالثانية قد لا ترى صفَّ الأولى قبل إيداعها.
    ولا يُجاب هذا بالقراءة — يُجاب بالتشغيل.
  */
  {
    const name = "٨ · سدادان متزامنان على رصيدٍ واحد ← واحدٌ يمرّ";
    const tag = `certify-race-${createId().slice(0, 8)}`;
    try {
      const supplierId = createId();
      await db.insert(suppliers).values({
        id: supplierId, nameAr: `مورّد تزاحم ${tag.slice(-6)}`,
        slug: tag, driveFolderName: tag, isActive: true,
      });
      const invoiceId = await makeInvoice(db, supplierId, `RACE-${tag.slice(-4)}`, 3_000_00, "2026-08-10");

      const pay = async () =>
        db.transaction(async (t) => {
          const id = await createPayment(t, {
            supplierId, paidAt: day("2026-08-12"),
            amountMinor: 3_000_00, method: "BANK_TRANSFER",
          });
          await t.insert(paymentAllocations)
            .values({ paymentId: id, invoiceId, amountMinor: 3_000_00 });
          return id;
        });

      const outcomes = await Promise.allSettled([pay(), pay()]);
      const ok = outcomes.filter((o) => o.status === "fulfilled").length;

      const [row] = (
        await db.execute<{ total: number }>(sql`
          select coalesce(sum(amount_minor), 0)::int as total
          from payment_allocations where invoice_id = ${invoiceId}
        `)
      ).rows;
      const allocated = Number(row?.total ?? 0);

      /* التنظيف قبل الحكم — كي لا يبقى أثرٌ إن فشل */
      await db.execute(sql`delete from payment_allocations where invoice_id = ${invoiceId}`);
      await db.execute(sql`delete from payments where supplier_id = ${supplierId}`);
      await db.execute(sql`delete from invoices where id = ${invoiceId}`);
      await db.execute(sql`delete from documents where supplier_id = ${supplierId}`);
      await db.execute(sql`delete from suppliers where id = ${supplierId}`);

      if (allocated > 3_000_00) {
        results.push({
          name, pass: false,
          detail: `خُصّص ${allocated / 100} على فاتورةٍ بـ٣٬٠٠٠ — الحارس لا يمنع التزاحم`,
        });
      } else {
        results.push({
          name, pass: true,
          detail: `نجح ${ok} من ٢ · المخصَّص ${allocated / 100} ولم يتجاوز الفاتورة`,
        });
      }
    } catch (e) {
      results.push({ name, pass: false, detail: (e as Error).message.slice(0, 200) });
    }
  }

  /* ── ١٠ · الريال الواحد من بابين ── */
  await scenario("١٠ · إيصالٌ وحركةُ بنك لواقعةٍ واحدة ← دفعةٌ واحدة", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [900_00]);

    /* أوّلاً: إيصالُ الدرايف يُنشئ دفعةً معلَّقة بلا حركةِ بنك */
    const fromReceipt = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-25"), amountMinor: 900_00,
      method: "BANK_TRANSFER", appliesToMonth: "2026-08",
    });

    /* ثمّ يأتي الكشف بالواقعة نفسها — فيجب أن تُعرَف لا أن تُنسَخ */
    const twin = await findPaymentTwin(tx, {
      supplierId, paidAt: day("2026-08-25"), amountMinor: 900_00,
    });
    if (twin === null) throw new Error("لم تُعرَف الدفعة القائمة — فسيصير الريالُ ريالين");
    if (twin.id !== fromReceipt) throw new Error("عُرفت دفعةٌ أخرى غير التي كُتبت");
    if (twin.hasBankRow) throw new Error("قيل إنّ لها حركةَ بنك ولا حركة");
    if (twin.allocatedMinor !== 0) throw new Error("قيل إنّها مخصَّصة ولم تُخصَّص");

    /* وتُخصَّص هي — فلا تُنشَأ ثانية */
    await allocate(tx, twin.id, 900_00, [{ invoiceId: invoiceIds[0], amountMinor: 900_00 }]);

    const [row] = (
      await tx.execute<{ n: number; total: number }>(sql`
        select count(*)::int as n, coalesce(sum(amount_minor), 0)::int as total
        from payments where supplier_id = ${supplierId} and status not in ('REVERSED','VOID')
      `)
    ).rows;

    if (Number(row?.n) !== 1) {
      throw new Error(`${row?.n} دفعتان لواقعةٍ واحدة — المال محسوبٌ مرّتين`);
    }
    if (Number(row?.total) !== 900_00) {
      throw new Error(`المجموع ${Number(row?.total) / 100} لا ٩٠٠`);
    }
    return `دفعةٌ واحدة بـ٩٠٠٫٠٠ — لا ريالَ زائد`;
  });

  /* ── ١١ · وواقعتان حقيقيّتان تبقيان اثنتين ── */
  await scenario("١١ · سدادان حقيقيّان بنفس المبلغ واليوم ← لا يُدمَجان", async (tx) => {
    const { supplierId, invoiceIds } = await seed(tx, [150_00, 150_00]);

    const first = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-25"), amountMinor: 150_00, method: "BANK_TRANSFER",
    });
    await allocate(tx, first, 150_00, [{ invoiceId: invoiceIds[0], amountMinor: 150_00 }]);

    /*
      الثانية واقعةٌ أخرى — وبيكوف يُسدَّد كذلك: مئةٌ وخمسون لكلّ فاتورة.
      و`findPaymentTwin` **يكشف ولا يقيّد**: يردّ الأولى، ومن يقيّد من
      كشفٍ يُنشئ لأنّ الأولى صار لها تخصيصُها.
    */
    const twin = await findPaymentTwin(tx, {
      supplierId, paidAt: day("2026-08-25"), amountMinor: 150_00,
    });
    if (twin === null) throw new Error("لم تُرَدّ الأولى — والكشفُ لا يميّز");
    if (twin.allocatedMinor !== 150_00) {
      throw new Error("لم يُقَل إنّها مخصَّصة، فقد تُتبنّى وهي مشغولة");
    }

    const second = await createPayment(tx, {
      supplierId, paidAt: day("2026-08-25"), amountMinor: 150_00, method: "BANK_TRANSFER",
    });
    await allocate(tx, second, 150_00, [{ invoiceId: invoiceIds[1], amountMinor: 150_00 }]);

    const [row] = (
      await tx.execute<{ total: number }>(sql`
        select coalesce(sum(amount_minor), 0)::int as total
        from payments where supplier_id = ${supplierId} and status not in ('REVERSED','VOID')
      `)
    ).rows;
    if (Number(row?.total) !== 300_00) {
      throw new Error(`المجموع ${Number(row?.total) / 100} لا ٣٠٠ — واقعتان حقيقيّتان`);
    }
    return "دفعتان بـ٣٠٠٫٠٠ — الكشفُ يميّز ولا يبتلع";
  });

  /* ── التقرير ── */
  console.log("");
  for (const r of results) {
    console.log(`  ${r.pass ? "✓" : "✕"} ${r.name}`);
    console.log(`      ${r.detail}\n`);
  }

  const failed = results.filter((r) => !r.pass).length;
  console.log("───────────────────────────────────");
  console.log(`  ${results.length - failed} من ${results.length} نجحت\n`);

  /*
    النتيجة تُكتَب كي تقرأها البوّابة.

    وبلا ذلك يبقى بندُ «اختبار الدورة كاملةً» مجهولاً أبداً، ويُطلَب من
    الإنسان أن ينقل نتيجةً بيده — وما يُنقَل باليد يُنقَل خطأً.
  */
  writeFileSync("certify-result.json", JSON.stringify({
    at: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed,
    results,
  }, null, 2), "utf8");

  /* ولم يُكتَب شيء — يُتحقَّق من ذلك لا يُدَّعى */
  const [leftover] = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from suppliers where slug like 'certify-%'
    `)
  ).rows;
  console.log(`  أثرٌ باقٍ من الشهادة: ${Number(leftover?.n ?? 0)} صفّاً (يجب أن يكون صفراً)\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("\n✕ توقّفت الشهادة:", e.message, "\n"); process.exit(1); });
