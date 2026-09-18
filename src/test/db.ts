/**
 * أدوات اختبارات القاعدة — `*.db.test.ts` وحدها.
 *
 * كلّ اختبارٍ يجري في معاملةٍ تُلغى في آخرها عمداً، على نمط `ops:certify`:
 * الخدمات نفسها على المخطّط الحقيقيّ، ولا يبقى صفّ. والإلغاء جزءٌ من
 * التصميم لا تنظيفٌ بعده: ما يُكتب ثمّ يُحذف يترك أثراً في سجلّ التدقيق،
 * وهو جدولٌ لا يُحذَف منه شيء.
 */
import { db } from "@/db";
import { documents, suppliers } from "@/db/schema";
import { createId } from "@/lib/id";
import { createInvoice } from "@/services/invoice.service";
import type { Tx } from "@/services/types";

class Rollback extends Error {}

/** يُجري `body` في معاملةٍ ثمّ يُلغيها — نجح أو رمى. وما رماه `body` يُعاد رميُه. */
export async function withRollback(body: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await body(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

export const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** خطأ Postgres تحت غلاف drizzle — الرمز والنصّ. */
export function pgErrorOf(e: unknown): { code?: string; message: string } | null {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const c = cur as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof c.code === "string") return { code: c.code, message: String(c.message ?? "") };
    cur = c.cause;
  }
  return null;
}

/** يُرجع ما رُمي — ويفشل إن لم يُرمَ شيء. */
export async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("كان متوقَّعاً أن يُرفَض — فمرّ");
}

export async function makeSupplier(tx: Tx): Promise<string> {
  const id = createId();
  await tx.insert(suppliers).values({
    id,
    nameAr: `مورّد اختبار ${id.slice(0, 6)}`,
    slug: `dbtest-${id.slice(0, 10)}`,
    driveFolderName: `dbtest-${id.slice(0, 10)}`,
    isActive: true,
  });
  return id;
}

/**
 * فاتورةٌ بمستندها — بخدمتها لا بإدراجٍ باليد.
 *
 * والمستند إلزاميّ في المخطّط، كما في المسار الحقيقيّ. وتمرّ الفاتورة
 * بـ`createInvoice` كي تمرّ بسياستها (حارس الشهر المقفل وغيره): تجهيزٌ
 * يكتب بيده يختبر مخطّطاً لا مساراً.
 */
export async function makeInvoice(tx: Tx, supplierId: string, totalMinor: number, isoDate: string): Promise<string> {
  const documentId = await makeDocument(tx, supplierId, isoDate);
  const subtotal = Math.round(totalMinor / 1.15);
  const id = await createInvoice(tx, {
    documentId,
    supplierId,
    invoiceNumber: `DBT-${documentId.slice(0, 8)}`,
    invoiceDate: day(isoDate),
    periodMonth: isoDate.slice(0, 7),
    subtotalMinor: subtotal,
    vatMinor: totalMinor - subtotal,
    totalMinor,
    taxStatus: "VALID",
    inputVatStatus: "ELIGIBLE",
    isFixedAsset: false,
  });
  if (!id) throw new Error("لم تُنشَأ فاتورة التجهيز");
  return id;
}

/** مستندٌ بلا فاتورة — لما يُنشئ الفاتورة بنفسه. */
export async function makeDocument(tx: Tx, supplierId: string, isoDate: string): Promise<string> {
  const id = createId();
  await tx.insert(documents).values({
    id,
    fileName: `dbtest-${id}.pdf`,
    mimeType: "application/pdf",
    supplierId,
    periodMonth: isoDate.slice(0, 7),
    kind: "TAX_INVOICE",
    status: "ARCHIVED",
  });
  return id;
}
