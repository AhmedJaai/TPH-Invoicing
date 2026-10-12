/**
 * الغربية 264343949 تعود ‏٣٬٤٠٠ (١٢ أكتوبر ٢٠٢٦، بقول أحمد): «كنتُ غلطان — الفاتورةُ الماضية صحيحة،
 * وكانت جمعاً لطلبيّة ‏١٬٧٠٠ مع طلبيّةٍ أخرى مطابقة». فما صنعه `repair-2026-10-12.ts` في بندها الثاني
 * يُعكَس بالمسار نفسه (`replaceWithCorrectedInvoice`): القيدُ يعود إلى مستنده الأوّل بقراءته
 * (سومطرة ٢٠ وعنب ١٠)، وملفُّ الـ‏١٬٧٠٠ يصير «مرفوضاً» لأنّه إحدى طلبيّتَي المجمَّعة لا فاتورةٌ
 * ثانية، وحوالةُ ٢٠ يونيو تعود كلُّها على الفاتورة. ملفُّ المجمَّعة في سلّة الدرايف — لا يُمسّ.
 *
 *   npx tsx --env-file=.env scripts/repair-2026-10-12b.ts [--i-know-this-is-production]
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, monthCloses } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { allocate } from "@/services/payment.service";
import { replaceWithCorrectedInvoice } from "@/services/invoice-replace.service";
import { writeAllowed } from "./lib/guard-write";

const WRITE = writeAllowed();
const AHMED = "04c5e101-08a2-434e-8817-b6c3f518ad2c";
const INVOICE = "6d925bd6-4b13-467d-867e-e345e7b46822";
const COMBINED_DOC = "985ed843-582f-4b1a-aa75-9a3b97beed98";
const SINGLE_DOC = "043d6f7e-a99c-453b-bd9c-8ad197dea6e3";
const PAYMENT = "a3cd7af9-d5c7-4575-8c44-6d4ac409fefb";
const NUMBER = "264343949";
const TOTAL = 340_000;
const WHY = "الغربية 264343949: المجمَّعةُ (‏٣٬٤٠٠) هي الصحيحة — طلبيّتان متطابقتان بـ‏١٬٧٠٠ — أُعيدت بقول أحمد (١٢ أكتوبر ٢٠٢٦)، نفّذه Claude";

async function state(label: string) {
  const [r] = (await db.execute<{ total: number; paid: string; doc: string; lines: string }>(sql`
    select i.total_minor as total, i.document_id as doc,
           coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as paid,
           (select string_agg(l.description || ' ' || l.qty::text, ' + ') from invoice_lines l where l.invoice_id = i.id) as lines
      from invoices i where i.id = ${INVOICE}`)).rows;
  console.log(`${label} إجمالي ${Number(r.total) / 100} · مخصَّص ${Number(r.paid) / 100} · ${r.lines} · مستند ${r.doc.slice(0, 8)}`);
  return r;
}

async function main() {
  const before = await state("قبل:");
  if (Number(before.total) === TOTAL && Number(before.paid) === TOTAL) { console.log("أُعيدت من قبل — لا شيء."); process.exit(0); }
  if (!WRITE) { console.log("تجربةٌ بلا كتابة."); process.exit(0); }

  const closed = await db.select().from(monthCloses).where(and(eq(monthCloses.month, "2026-06"), eq(monthCloses.status, "CLOSED")));
  for (const c of closed) {
    await db.update(monthCloses).set({ status: "OPEN", closedAt: null, closedById: null }).where(eq(monthCloses.id, c.id));
    await recordAudit({ actorId: AHMED, action: "MONTH_REOPENED", entityType: "month_close", entityId: c.month, before: { الحالة: "CLOSED" }, after: { الحالة: "OPEN", السبب: WHY } });
  }
  try {
    await db.transaction(async (t) => {
      if (Number(before.total) !== TOTAL) {
        /* رقمُها من اسم ملفّها كما قُيِّدت أوّلَ مرّة — القراءةُ لم تحمله */
        await t.update(documents).set({
          status: "NEEDS_REVIEW", statusNote: null,
          extractionJson: sql`jsonb_set(${documents.extractionJson}, '{invoiceNumber}', ${JSON.stringify(NUMBER)}::jsonb)`,
        }).where(eq(documents.id, COMBINED_DOC));
        const out = await replaceWithCorrectedInvoice(t, COMBINED_DOC, AHMED);
        if (out.oldDocumentId !== SINGLE_DOC) throw new Error("المستندُ المستبدَل ليس ملفَّ الـ١٬٧٠٠");
        await t.update(documents).set({ statusNote: "إحدى طلبيّتَي الفاتورة المجمَّعة 264343949 (‏٣٬٤٠٠) — ليست فاتورةً ثانية" }).where(eq(documents.id, SINGLE_DOC));
        await recordAudit({ actorId: AHMED, action: "DOCUMENT_REJECTED", entityType: "document", entityId: SINGLE_DOC, after: { السبب: WHY } }, t);
      }
      const [mid] = (await t.execute<{ paid: string }>(sql`select coalesce(sum(amount_minor), 0)::bigint as paid from payment_allocations where invoice_id = ${INVOICE}`)).rows;
      const open = TOTAL - Number(mid.paid);
      if (open > 0) await allocate(t, PAYMENT, [{ invoiceId: INVOICE, amountMinor: open }]);
      const [g] = (await t.execute<{ total: number; paid: string }>(sql`
        select i.total_minor as total, coalesce((select sum(pa.amount_minor) from payment_allocations pa where pa.invoice_id = i.id), 0)::bigint as paid
          from invoices i where i.id = ${INVOICE}`)).rows;
      if (Number(g.total) !== TOTAL || Number(g.paid) !== TOTAL) throw new Error(`إجمالي ${g.total} ومخصَّص ${g.paid} — المنتظَر ${TOTAL}`);
    });
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
